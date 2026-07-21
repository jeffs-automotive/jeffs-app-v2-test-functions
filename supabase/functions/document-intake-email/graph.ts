// Microsoft Graph client for document-intake-email (plan D7/D8).
//
// Client-credentials daemon auth — the app's mail access comes from the
// Exchange RBAC scope (runbook §1d), NOT a tenant-wide Entra grant. All
// message reads send `Prefer: IdType="ImmutableId"` so ids survive moves
// (cross-verify: mutable ids 404 after a rule files the message).
//
// `fetchImpl` is injectable for tests; production uses global fetch.

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export interface GraphMessageMeta {
  id: string;
  internetMessageId: string | null;
  subject: string | null;
  from: string | null;
  receivedDateTime: string | null;
  hasAttachments: boolean;
}

export interface GraphAttachmentMeta {
  id: string;
  name: string | null;
  contentType: string | null;
  size: number;
  isInline: boolean;
  odataType: string; // "#microsoft.graph.fileAttachment" | itemAttachment | referenceAttachment
}

export interface GraphSubscription {
  id: string;
  resource: string;
  expirationDateTime: string;
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_SKEW_MS = 60_000;

export class GraphClient {
  #cfg: GraphConfig;
  #fetch: typeof fetch;
  #token: string | null = null;
  #tokenExpiresAt = 0;

  constructor(cfg: GraphConfig) {
    this.#cfg = cfg;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async #getToken(): Promise<string> {
    if (this.#token && Date.now() < this.#tokenExpiresAt - TOKEN_SKEW_MS) return this.#token;
    const res = await this.#fetch(
      `https://login.microsoftonline.com/${this.#cfg.tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.#cfg.clientId,
          client_secret: this.#cfg.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }).toString(),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`graph token failed: HTTP ${res.status} ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!parsed.access_token) throw new Error("graph token response missing access_token");
    this.#token = parsed.access_token;
    this.#tokenExpiresAt = Date.now() + (parsed.expires_in ?? 3600) * 1000;
    return this.#token;
  }

  async #req(method: string, url: string, body?: unknown): Promise<Response> {
    const token = await this.#getToken();
    return await this.#fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: 'IdType="ImmutableId"',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async #json<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await this.#req(method, url, body);
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`graph ${method} ${url.slice(GRAPH.length, GRAPH.length + 80)}: HTTP ${res.status} ${text.slice(0, 300)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return text.length ? JSON.parse(text) as T : ({} as T);
  }

  // ── Subscriptions ──────────────────────────────────────────────────────
  async createSubscription(args: {
    mailbox: string;
    notificationUrl: string;
    lifecycleNotificationUrl: string;
    clientState: string;
    expirationDateTime: string;
  }): Promise<GraphSubscription> {
    return await this.#json<GraphSubscription>("POST", `${GRAPH}/subscriptions`, {
      changeType: "created",
      resource: `/users/${args.mailbox}/mailFolders('inbox')/messages`,
      notificationUrl: args.notificationUrl,
      lifecycleNotificationUrl: args.lifecycleNotificationUrl,
      clientState: args.clientState,
      expirationDateTime: args.expirationDateTime,
    });
  }

  async renewSubscription(id: string, expirationDateTime: string): Promise<GraphSubscription> {
    return await this.#json<GraphSubscription>("PATCH", `${GRAPH}/subscriptions/${id}`, {
      expirationDateTime,
    });
  }

  async deleteSubscription(id: string): Promise<void> {
    const res = await this.#req("DELETE", `${GRAPH}/subscriptions/${id}`);
    // 404 = already gone — fine.
    if (!res.ok && res.status !== 404) {
      throw new Error(`graph DELETE subscription ${id}: HTTP ${res.status}`);
    }
    await res.text();
  }

  // ── Messages ───────────────────────────────────────────────────────────
  async getMessageMeta(mailbox: string, messageId: string): Promise<GraphMessageMeta> {
    const raw = await this.#json<{
      id: string;
      internetMessageId?: string;
      subject?: string;
      from?: { emailAddress?: { address?: string } };
      receivedDateTime?: string;
      hasAttachments?: boolean;
    }>(
      "GET",
      `${GRAPH}/users/${mailbox}/messages/${messageId}?$select=id,internetMessageId,subject,from,receivedDateTime,hasAttachments`,
    );
    return {
      id: raw.id,
      internetMessageId: raw.internetMessageId ?? null,
      subject: raw.subject ?? null,
      from: raw.from?.emailAddress?.address ?? null,
      receivedDateTime: raw.receivedDateTime ?? null,
      hasAttachments: raw.hasAttachments ?? false,
    };
  }

  /** Rolling-window sweep list (Inbox or Junk), fully paged (plan D8). */
  async listMessagesSince(
    mailbox: string,
    folder: "inbox" | "junkemail",
    sinceIso: string,
  ): Promise<GraphMessageMeta[]> {
    const out: GraphMessageMeta[] = [];
    let url: string | null =
      `${GRAPH}/users/${mailbox}/mailFolders('${folder}')/messages` +
      `?$filter=receivedDateTime ge ${sinceIso}` +
      `&$select=id,internetMessageId,subject,from,receivedDateTime,hasAttachments&$top=50`;
    while (url) {
      const page: {
        value?: Array<Record<string, unknown>>;
        "@odata.nextLink"?: string;
      } = await this.#json("GET", url);
      for (const raw of page.value ?? []) {
        const from = raw.from as { emailAddress?: { address?: string } } | undefined;
        out.push({
          id: String(raw.id),
          internetMessageId: (raw.internetMessageId as string | undefined) ?? null,
          subject: (raw.subject as string | undefined) ?? null,
          from: from?.emailAddress?.address ?? null,
          receivedDateTime: (raw.receivedDateTime as string | undefined) ?? null,
          hasAttachments: (raw.hasAttachments as boolean | undefined) ?? false,
        });
      }
      url = page["@odata.nextLink"] ?? null;
    }
    return out;
  }

  /** Attachment metadata, fully paged, contentBytes deliberately excluded. */
  async listAttachments(mailbox: string, messageId: string): Promise<GraphAttachmentMeta[]> {
    const out: GraphAttachmentMeta[] = [];
    let url: string | null =
      `${GRAPH}/users/${mailbox}/messages/${messageId}/attachments` +
      `?$select=id,name,contentType,size,isInline&$top=20`;
    while (url) {
      const page: {
        value?: Array<Record<string, unknown>>;
        "@odata.nextLink"?: string;
      } = await this.#json("GET", url);
      for (const raw of page.value ?? []) {
        out.push({
          id: String(raw.id),
          name: (raw.name as string | undefined) ?? null,
          contentType: (raw.contentType as string | undefined) ?? null,
          size: Number(raw.size ?? 0),
          isInline: Boolean(raw.isInline ?? false),
          odataType: String(raw["@odata.type"] ?? ""),
        });
      }
      url = page["@odata.nextLink"] ?? null;
    }
    return out;
  }

  /** Raw attachment bytes via /$value — works for any size, streams nothing to disk. */
  async getAttachmentBytes(mailbox: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
    const res = await this.#req(
      "GET",
      `${GRAPH}/users/${mailbox}/messages/${messageId}/attachments/${attachmentId}/$value`,
    );
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`graph attachment $value: HTTP ${res.status} ${text.slice(0, 200)}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}

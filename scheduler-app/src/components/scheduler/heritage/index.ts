// Barrel for the Heritage Editorial scheduler cards (Chunk 6 — 2026-05-13).
//
// These are the NEW cards introduced by the design lock; legacy cards in
// src/components/scheduler/ (PhoneEntry, OtpInput, etc.) continue to exist
// and will be incrementally migrated to this folder + Heritage style as the
// chunks roll out. New cards go HERE; refactored legacy cards move HERE.

export { GreetingCard } from "./GreetingCard";
export type { GreetingCardProps } from "./GreetingCard";

export { ClarificationQuestionCard } from "./ClarificationQuestionCard";
export type { ClarificationQuestionCardProps } from "./ClarificationQuestionCard";

export { ConcernExplanationCard } from "./ConcernExplanationCard";
export type { ConcernExplanationCardProps } from "./ConcernExplanationCard";

export { DiagnosticLoadingCard } from "./DiagnosticLoadingCard";
export type { DiagnosticLoadingCardProps } from "./DiagnosticLoadingCard";

export { TestingServiceApprovalCard } from "./TestingServiceApprovalCard";
export type { TestingServiceApprovalCardProps } from "./TestingServiceApprovalCard";

export { AppointmentTypeCard } from "./AppointmentTypeCard";
export type { AppointmentTypeCardProps } from "./AppointmentTypeCard";

export { CustomerNotesCard } from "./CustomerNotesCard";
export type { CustomerNotesCardProps } from "./CustomerNotesCard";

export { CustomerQuestionCard } from "./CustomerQuestionCard";
export type { CustomerQuestionCardProps } from "./CustomerQuestionCard";

export { SummaryCard } from "./SummaryCard";
export type { SummaryCardProps } from "./SummaryCard";

export { CompletedCard } from "./CompletedCard";
export type { CompletedCardProps } from "./CompletedCard";

export { CustomerInfoEditCard } from "./CustomerInfoEditCard";
export type {
  CustomerInfoEditCardProps,
  PhoneEntry,
  EmailEntry,
  AddressEntry,
} from "./CustomerInfoEditCard";

export { NoMatchChoosePathCard } from "./NoMatchChoosePathCard";
export type { NoMatchChoosePathCardProps } from "./NoMatchChoosePathCard";

export { PartialVerificationGateCard } from "./PartialVerificationGateCard";
export type { PartialVerificationGateCardProps } from "./PartialVerificationGateCard";

export { MultiAccountDisambiguationCard } from "./MultiAccountDisambiguationCard";
export type {
  MultiAccountDisambiguationCardProps,
  MultiAccountCandidate,
} from "./MultiAccountDisambiguationCard";

export { PhoneNameCard } from "./PhoneNameCard";
export type { PhoneNameCardProps } from "./PhoneNameCard";

export { ChatBubble } from "./ChatBubble";
export type { ChatBubbleProps } from "./ChatBubble";

export { WizardFooter } from "./WizardFooter";
export type { WizardFooterProps } from "./WizardFooter";

// Spec-aligned new-client cards (chat-design.md §2595-2755).
// Replace the legacy combined NewCustomerForm.
export { NewCustomerInfoCard } from "./NewCustomerInfoCard";
export type { NewCustomerInfoCardProps } from "./NewCustomerInfoCard";

export { NewVehicleCard } from "./NewVehicleCard";
export type { NewVehicleCardProps } from "./NewVehicleCard";

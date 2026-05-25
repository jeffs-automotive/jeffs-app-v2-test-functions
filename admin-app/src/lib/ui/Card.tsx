import type { HTMLAttributes, ReactNode } from "react";

/**
 * Admin-app Card — simplified version of scheduler-app's editorial Card.
 * White background, hairline stone border, generous padding.
 *
 * Composition:
 *   <Card>
 *     <Card.Header>
 *       <Card.Title>...</Card.Title>
 *       <Card.Description>...</Card.Description>
 *     </Card.Header>
 *     <Card.Body>...</Card.Body>
 *     <Card.Footer>...</Card.Footer>
 *   </Card>
 */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-stone-200 bg-white shadow-sm ${className ?? ""}`}
      {...rest}
    >
      {children}
    </div>
  );
}

function Header({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`border-b border-stone-200 p-6 ${className ?? ""}`}>
      {children}
    </div>
  );
}

function Title({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`text-lg font-semibold text-stone-900 ${className ?? ""}`}
    >
      {children}
    </h2>
  );
}

function Description({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`mt-1 text-sm text-stone-600 ${className ?? ""}`}>{children}</p>
  );
}

function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`p-6 ${className ?? ""}`}>{children}</div>;
}

function Footer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-6 py-4 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

Card.Header = Header;
Card.Title = Title;
Card.Description = Description;
Card.Body = Body;
Card.Footer = Footer;

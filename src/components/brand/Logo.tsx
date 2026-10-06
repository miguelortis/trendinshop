import Link from "next/link";

type LogoProps = {
  compact?: boolean;
  href?: string;
  inverted?: boolean;
};

export function Logo({ compact = false, href = "/", inverted = false }: LogoProps) {
  return (
    <Link href={href} className="ts-logo" aria-label="TrendinShop">
      <span className="ts-logo-mark" aria-hidden="true">
        <svg viewBox="0 0 42 42" width="28" height="28" fill="none">
          <path d="M12 16.5h18l-1.5 16H13.5L12 16.5Z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M16 16.5C16.2 11.8 18.2 9.5 21 9.5s4.8 2.3 5 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M17 21h4.5l-2.2 7 5.7-7H21l2-4" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <span className="ts-logo-word" style={{ color: inverted ? "white" : undefined }}>
          Trendin<span className="ts-logo-accent">Shop</span>
        </span>
      )}
    </Link>
  );
}

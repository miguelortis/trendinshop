import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

type PageProps = { searchParams: Promise<{ token?: string }> };

export const metadata = {
  title: "Restablecer contraseña",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const { token = "" } = await searchParams;
  return <ResetPasswordForm token={token} />;
}

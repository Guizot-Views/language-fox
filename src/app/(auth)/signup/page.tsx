import { AuthView } from "@/components/AuthView";

export const metadata = {
  title: "Daftar Akun — Language Fox",
  description: "Buat akun baru di Language Fox",
};

export default function SignupPage() {
  return <AuthView initialMode="signup" />;
}

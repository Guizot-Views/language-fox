import { AuthView } from "@/components/AuthView";

export const metadata = {
  title: "Masuk — Language Fox",
  description: "Masuk ke akun Language Fox Anda",
};

export default function LoginPage() {
  return <AuthView initialMode="signin" />;
}

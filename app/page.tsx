import { redirect } from "next/navigation";

// `/` used to be the "start a new store" screen; that UI now lives at components/StartStoreHero
// and is shown by the dashboard itself when the account has no stores yet, so there is exactly
// one entry point instead of two divergent ones.
export default function Home() {
  redirect("/dashboard");
}

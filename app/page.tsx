import { redirect } from "next/navigation";

// The app has no bare landing page — send the owner straight to Metrics.
export default function Home() {
  redirect("/metrics");
}

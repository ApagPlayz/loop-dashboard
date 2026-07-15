import AppShell from "@/components/app-shell";

// Everything under this route group renders inside the authenticated app shell.
// The /login page lives outside the group, so it stays chrome-free.
export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

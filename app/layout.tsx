import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "BIU Racing | תיק החשמל 2027",
  description: "מסמכי ענף החשמל של BIU Racing לשנת 2027.",
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="he" dir="rtl"><body>{children}</body></html>;
}

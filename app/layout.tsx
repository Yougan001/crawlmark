import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL('https://yougan001.github.io/crawlmark/'),
  title: 'Crawlmark — URL SEO inspection',
  description:
    'Inspect a public page for technical SEO and content-access signals, with evidence and practical fixes.',
  alternates: { canonical: 'https://yougan001.github.io/crawlmark/' },
  icons: {
    icon: `${process.env.GITHUB_PAGES ? '/crawlmark' : ''}/favicon.svg`,
  },
  openGraph: {
    title: 'Crawlmark — inspect the page, keep the evidence',
    description:
      'A transparent technical SEO and content-access checklist, with a self-hosted URL inspection API.',
    type: 'website',
    url: 'https://yougan001.github.io/crawlmark/',
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

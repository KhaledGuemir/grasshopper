import './globals.css';

export const metadata = {
  title: 'Grasshopper Pasture',
  description: 'A first-person pasture sandbox: lift animals, ride beasts, explore cities and islands.',
  other: {
    'claude:viewport-fit-sides': 'cover',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;800&family=Titan+One&display=swap"
        rel="stylesheet"
        precedence="default"
      />
      <body>{children}</body>
    </html>
  );
}

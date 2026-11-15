import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Madrid Office Market | Alquiler de oficinas', description: 'Comparador de alquiler de oficinas en Madrid capital' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="es"><body>{children}</body></html>; }

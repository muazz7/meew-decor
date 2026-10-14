import type { Metadata } from 'next';
import './globals.css';
const siteOrigin = process.env.SITE_PUBLIC_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://meew-decor.bouncygrape.chatgpt.site');
export const metadata: Metadata = {
 referrer:'no-referrer',
 title:'Meew Decor — Little details. Lovely living.',
 description:'Explore floor lamps, wooden organisers and natural textures for your home. Discover Meew Decor, Bosila, Dhaka.',
 metadataBase:new URL(siteOrigin),
 openGraph:{title:'Meew Decor — Little details. Lovely living.',description:'Thoughtful home décor from Meew Decor, Dhaka.',images:['/images/sculptural-lamp.jpg'],type:'website'},
 icons:{icon:'/favicon.svg'},
};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}

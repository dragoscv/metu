import Image from 'next/image'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export default function Home() {
  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-center ${inter.className}`}
    >
      <a href="mailto:contact@metu.ro" className="text-4xl font-bold">contact@metu.ro</a>
    </main>
  )
}

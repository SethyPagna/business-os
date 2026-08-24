import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import './styles/main.css'
import ImageGalleryLightbox from './components/shared/ImageGalleryLightbox'

// wide landscape and tall portrait test images (data URIs, solid color + border via SVG)
function svgDataUri(w: number, h: number, color: string, label: string) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'><rect width='100%' height='100%' fill='${color}'/><rect x='4' y='4' width='${w-8}' height='${h-8}' fill='none' stroke='white' stroke-width='6'/><text x='50%' y='50%' font-size='40' fill='white' text-anchor='middle' dominant-baseline='middle'>${label}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

function App() {
  const [idx, setIdx] = useState(0)
  const images = [
    svgDataUri(1600, 900, '#2563eb', 'landscape 16:9'),
    svgDataUri(900, 1600, '#16a34a', 'portrait 9:16'),
    svgDataUri(1000, 1000, '#dc2626', 'square 1:1'),
  ]
  return (
    <ImageGalleryLightbox
      open
      title="Test Product"
      images={images}
      index={idx}
      onClose={() => {}}
      onIndexChange={setIdx}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)

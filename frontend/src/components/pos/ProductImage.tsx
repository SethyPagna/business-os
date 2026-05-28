import type { ComponentType } from 'react'
import { ProductImg as ProductImgComponent } from '../products/shared/primitives.jsx'

type ProductImageProps = {
  src?: string
  alt?: string
  className?: string
}

const ProductImg = ProductImgComponent as ComponentType<ProductImageProps>

export default function ProductImage({ src, alt, className }: ProductImageProps) {
  return <ProductImg src={src} alt={alt} className={className} />
}

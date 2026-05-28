import { ProductImg } from '../products/shared/primitives'

type ProductImageProps = {
  src?: string
  alt?: string
  className?: string
}

export default function ProductImage({ src, alt, className }: ProductImageProps) {
  return <ProductImg src={src} alt={alt} className={className} />
}

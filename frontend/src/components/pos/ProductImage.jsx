import { ProductImg } from '../products/primitives'

export default function ProductImage({ src, alt, className }) {
  return <ProductImg src={src} alt={alt} className={className} />
}

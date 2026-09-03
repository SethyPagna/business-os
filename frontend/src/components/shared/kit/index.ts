// Barrel export for the P2-1 design kit. Page adoption (P2-4/P2-5) imports
// primitives from here (`import { Button, Fold } from
// 'components/shared/kit'`) rather than reaching into individual files.
export { default as Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button'
export { default as IconButton, type IconButtonProps } from './IconButton'
export { default as Chip, type ChipProps } from './Chip'
export { default as SectionHeader, type SectionHeaderProps } from './SectionHeader'
export { default as ControlRow, type ControlRowProps } from './ControlRow'
export { default as OverflowMenu, type OverflowMenuProps, type OverflowMenuItem } from './OverflowMenu'
export { default as StatStrip, type StatStripProps, type StatCardDef, type StatDetail } from './StatStrip'
export { default as Fold, type FoldProps } from './Fold'
export { default as EmptyState, type EmptyStateProps } from './EmptyState'
export { default as Skeleton, type SkeletonProps, type SkeletonVariant } from './Skeleton'
export { default as DenseTable, DenseTableExpandCell, type DenseTableProps } from './DenseTable'
export { default as TileGrid, type TileGridProps, type TileGridItem } from './TileGrid'
export { default as HubTile, type HubTileProps } from './HubTile'
export { zLayers, zLayerVar, type ZLayerName } from './zLayers'

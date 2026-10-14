// A host for the five surfaces that hold a frozen draft authority (Expense form + page, Branch form + page, Product
// form), for tests that mount them through mountedComponentHarness.ts (component: '../tests/draftAuthorityHost.ts').
//
// It also publishes the actorReadScope.ts instance the mounted surfaces use, under a well-known symbol. A mounted
// surface runs in the harness's own module graph, so a test that imported actorReadScope.ts natively would act on a
// DIFFERENT instance -- its session reset would look to the surfaces like another tab changing the sign-in. Going
// through this instance makes the reset what a reconnect does inside the tab that is open.
import { createElement, type ReactElement } from 'react'
import * as actor from '../src/api/actorReadScope.ts'
import BranchForm from '../src/components/branches/BranchForm.tsx'
import Branches from '../src/components/branches/Branches.tsx'
import FeeForm from '../src/components/fees/FeeForm.tsx'
import FeesPage from '../src/components/fees/FeesPage.tsx'
import ProductForm from '../src/components/products/forms/ProductForm.tsx'

export const ACTOR_INSTANCE = Symbol.for('draftAuthorityHost.actor')
;(globalThis as Record<symbol, unknown>)[ACTOR_INSTANCE] = actor

const SURFACES = { 'fee-form': FeeForm, 'fees-page': FeesPage, 'branch-form': BranchForm, 'branches-page': Branches, 'product-form': ProductForm } as const
type HostProps = { surface: keyof typeof SURFACES } & Record<string, unknown>

export default function DraftAuthorityHost({ surface, ...props }: HostProps): ReactElement {
  return createElement(SURFACES[surface] as unknown as (props: Record<string, unknown>) => ReactElement, props)
}

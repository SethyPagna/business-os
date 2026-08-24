import type * as PortalPublicTransport from './api/portalPublicTransport.ts'

type PortalMethodName =
  | 'askPortalAi'
  | 'createPortalSubmission'
  | 'getPortalAiStatus'
  | 'getPortalBootstrap'
  | 'getPortalCatalogMeta'
  | 'getPortalCatalogProducts'
  | 'getPortalConfig'
  | 'lookupPortalMembership'
  | 'searchPortalCatalogProducts'
type PublicPortalMethod = (...args: unknown[]) => Promise<unknown>
type PublicPortalApi = Record<PortalMethodName, PublicPortalMethod>

let portalTransportPromise: Promise<typeof PortalPublicTransport> | null = null

function loadPortalTransport(): Promise<typeof PortalPublicTransport> {
  if (!portalTransportPromise) portalTransportPromise = import('./api/portalPublicTransport.ts')
  return portalTransportPromise
}

function getPortalMethod(name: PortalMethodName): PublicPortalMethod {
  return (...args) =>
    loadPortalTransport().then((module) => {
      const method = module[name] as PublicPortalMethod
      return method(...args)
    })
}

const publicApi: PublicPortalApi = {
  askPortalAi: getPortalMethod('askPortalAi'),
  createPortalSubmission: getPortalMethod('createPortalSubmission'),
  getPortalAiStatus: getPortalMethod('getPortalAiStatus'),
  getPortalBootstrap: getPortalMethod('getPortalBootstrap'),
  getPortalCatalogMeta: getPortalMethod('getPortalCatalogMeta'),
  getPortalCatalogProducts: getPortalMethod('getPortalCatalogProducts'),
  getPortalConfig: getPortalMethod('getPortalConfig'),
  lookupPortalMembership: getPortalMethod('lookupPortalMembership'),
  searchPortalCatalogProducts: getPortalMethod('searchPortalCatalogProducts'),
}

if (typeof window !== 'undefined') {
  window.api = {
    ...(window.api || {}),
    ...publicApi,
  }
}

import type * as PortalTransport from './api/portalTransport.ts'

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

let portalTransportPromise: Promise<typeof PortalTransport> | null = null

function loadPortalTransport(): Promise<typeof PortalTransport> {
  if (!portalTransportPromise) portalTransportPromise = import('./api/portalTransport.ts')
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

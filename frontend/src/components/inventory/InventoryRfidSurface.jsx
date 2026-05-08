export default function InventoryRfidSurface({
  ClipboardList,
  RFID_INVENTORY_WORKFLOWS,
  RFID_READER_REQUIREMENTS,
  SectionSwitcher,
  rfidGatewayStatus,
  rfidSection,
  rfidSectionOptions,
  setRfidSection,
  tr,
}) {
  return (
        <div className="space-y-3">
          <SectionSwitcher
            label="RFID"
            options={rfidSectionOptions}
            value={rfidSection}
            onChange={setRfidSection}
            storageKey="business-os:inventory:rfid-section"
          />
          {(rfidSection === 'all' || rfidSection === 'overview') ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
                  <ClipboardList className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  {tr('rfid_inventory_title', 'RFID inventory', '????? RFID')}
                </div>
                <p className="mt-1 max-w-3xl text-xs text-gray-500 dark:text-gray-400">
                  {tr('rfid_inventory_desc', 'Manage reader readiness, EPC / TID mapping, stock counts, receiving, transfers, POS checks, and exceptions from one Inventory section.', '????????? reader, ????????? EPC / TID, ?????????, ?????????, ?????, ??????? POS ??????????????????????????????????')}
                </p>
              </div>
              <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${rfidGatewayStatus.connected ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'}`}>
                {tr('rfid_reader_gateway', 'Reader gateway', 'Reader gateway')}: {rfidGatewayStatus.label}
              </span>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [tr('rfid_reader_gateway', 'Reader gateway', 'Reader gateway'), `${rfidGatewayStatus.readerCount} ${tr('online', 'online', 'online')}`, rfidGatewayStatus.lastHeartbeat],
                [tr('rfid_active_session', 'Active session', '?????????'), rfidGatewayStatus.activeSession, rfidGatewayStatus.branchName],
                [tr('rfid_queued_reads', 'Queued reads', '?????????????????'), rfidGatewayStatus.queuedReads, tr('rfid_awaiting_sync_apply', 'Awaiting sync/apply', '??????????? sync/apply')],
                [tr('rfid_unknown_tags', 'Unknown tags', '??????????????'), rfidGatewayStatus.unknownTags, tr('rfid_need_product_mapping', 'Need product mapping', '????????????????????')],
              ].map(([label, value, note]) => (
                <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
                  <div className="mt-1 text-sm font-bold text-gray-900 dark:text-white">{value}</div>
                  <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{note}</div>
                </div>
              ))}
            </div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'tagging' || rfidSection === 'stock-count' || rfidSection === 'search') ? (
          <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_workflows', 'RFID workflows', '???????? RFID')}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{tr('rfid_workflows_desc', 'Choose a session type before readers start changing stock.', '??????????????? ?????? reader ??????????????????????????')}</div>
                </div>
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled title={tr('rfid_reader_gateway_required', 'Enable after a reader gateway is connected.', '???????????????????? reader gateway?')}>
                  {tr('rfid_start_stock_count', 'Start RFID stock count', '?????????????????? RFID')}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {RFID_INVENTORY_WORKFLOWS.map((workflow) => (
                  <div key={workflow.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                    <div className="font-semibold text-gray-900 dark:text-white">{tr(workflow.labelKey, workflow.label)}</div>
                    <div className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{tr(workflow.descriptionKey, workflow.description)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_tag_lookup_mapping', 'Tag lookup and mapping', '??????? ??????????????')}</div>
              <div className="mt-2 grid gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">EPC / TID</span>
                  <input className="input text-sm" placeholder={tr('rfid_paste_scan_tag_id', 'Paste or scan tag id', '????????? ??????????????')} disabled title={tr('rfid_reader_not_connected_title', 'Reader integration is not connected yet.', '????????????? reader integration?')} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{tr('rfid_map_product_variant', 'Map to product or variant', '?????????????? ??????????')}</span>
                  <input className="input text-sm" placeholder={tr('rfid_search_product_tag_placeholder', 'Search product, SKU, barcode, or variant', '????????????? SKU barcode ??????????')} disabled title={tr('rfid_mapping_title', 'Mapping turns reader scans into stock movements.', '?????????????????????????? reader ??????????????')} />
                </label>
                <div className="rounded-xl bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                  {tr('rfid_barcode_fallback_note', 'Barcode fallback stays available for untagged products, offline readers, and emergency receiving.', 'Barcode fallback ??????????????????????????????????? reader ?????????? ???????????????????????')}
                </div>
              </div>
            </div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'exceptions') ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="font-semibold">{tr('rfid_exceptions', 'RFID exceptions', '?????????? RFID')}</div>
            <div className="mt-1 text-xs">{tr('rfid_exceptions_desc', 'Wrong-location, unknown, missing, and extra tags stay in review until an authorized user applies or dismisses them.', '?????????????? ????????? ???? ???? ?????????????????????????????????????????????? ????????')}</div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'sessions') ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_sessions', 'RFID sessions', '???? RFID')}</div>
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{tr('rfid_sessions_desc', 'Branch, area, reader, ledger totals, confirmed tag presence, and manual apply results are audited per session.', '???? ????? reader ???? ledger ?????????????????? ????????? apply ????? ???????? audit ????????')}</div>
          </div>
          ) : null}

          {(rfidSection === 'all' || rfidSection === 'overview') ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800/70">
            <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">{tr('rfid_implementation_checklist', 'Implementation checklist', '??????????????????????')}</div>
            <div className="grid gap-2 md:grid-cols-3">
              {RFID_READER_REQUIREMENTS.map((item, index) => (
                <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300">
                  <span className="mr-1 font-bold text-blue-600 dark:text-blue-300">{index + 1}.</span>
                  {tr(item.key, item.text)}
                </div>
              ))}
            </div>
          </div>
          ) : null}
        </div>
  )
}

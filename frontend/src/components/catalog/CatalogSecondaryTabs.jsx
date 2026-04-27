import React from 'react'
import {
  BadgeDollarSign,
  Bot,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MapPin,
  RotateCcw,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  Store,
  Ticket,
  Upload,
} from 'lucide-react'
import { SectionShell, StatusPill, SummaryTile } from './catalogUi'

function CatalogMembershipSection(props) {
  const {
    copy,
    formatDateTime,
    formatPortalPrice,
    membershipNumber,
    setMembershipNumber,
    handleMembershipLookup,
    membershipLoading,
    membershipError,
    membershipData,
    previewConfig,
    redeemSummaryText,
    submissionDraft,
    setSubmissionDraft,
    submissionSaving,
    handleSubmissionPaste,
    handleSubmitShareProof,
    handleUploadSubmissionImages,
    openPortalImage,
  } = props

  return (
    <SectionShell
      title={copy('membershipLookup', 'Membership lookup')}
      subtitle={copy('membershipLookupHint', 'Customers can view purchases, returns, and points. They cannot edit anything.')}
    >
      <div className="rounded-[28px] bg-slate-950 p-5 text-white shadow-lg">
        <div className="grid gap-4 lg:grid-cols-[1.6fr,auto]">
          <label htmlFor="portal-membership-number" className="block">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('membership', 'Membership')}</div>
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <Ticket className="h-5 w-5 text-cyan-300" />
              <input
                id="portal-membership-number"
                name="membership_number"
                autoComplete="off"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
                placeholder={copy('membershipPlaceholder', 'Enter membership number')}
                value={membershipNumber}
                onChange={(event) => setMembershipNumber(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleMembershipLookup()
                }}
              />
            </div>
          </label>

          <button
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            onClick={handleMembershipLookup}
            disabled={membershipLoading}
          >
            <Search className="h-4 w-4" />
            {membershipLoading ? copy('checkingMembership', 'Checking membership...') : copy('lookup', 'Check membership')}
          </button>
        </div>

        {membershipError ? (
          <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            {membershipError}
          </div>
        ) : null}
      </div>

      {membershipData ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1.2fr,1fr]">
            <SectionShell
              title={copy('customer', 'Customer')}
              subtitle={membershipData.customer?.name || ''}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('membership', 'Membership')}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer?.membership_number || '-'}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('memberSince', 'Member since')}</div>
                  <div className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(membershipData.customer?.created_at)}</div>
                </div>
                {membershipData.customer?.phone ? (
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('phone', 'Phone')}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer.phone}</div>
                  </div>
                ) : null}
                {membershipData.customer?.email ? (
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('email', 'Email')}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer.email}</div>
                  </div>
                ) : null}
                {membershipData.customer?.company ? (
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('company', 'Company')}</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{membershipData.customer.company}</div>
                  </div>
                ) : null}
                {membershipData.customer?.notes ? (
                  <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('note', 'Note')}</div>
                    <div className="mt-2 text-sm text-slate-700">{membershipData.customer.notes}</div>
                  </div>
                ) : null}
              </div>
            </SectionShell>

            <div className="grid gap-4 sm:grid-cols-2">
              <SummaryTile
                icon={Sparkles}
                label={copy('pointsBalance', 'Point balance')}
                value={(membershipData.points?.balance || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                tone="blue"
              />
              {previewConfig.showPointValue ? (
                <SummaryTile
                  icon={BadgeDollarSign}
                  label={copy('pointsValue', 'Point value')}
                  value={formatPortalPrice(membershipData.points?.redeemValueUsd, membershipData.points?.redeemValueKhr, previewConfig)}
                  tone="green"
                />
              ) : null}
              <SummaryTile
                icon={Store}
                label={copy('totalSales', 'Sales total')}
                value={formatPortalPrice(membershipData.totals?.totalSalesUsd, membershipData.totals?.totalSalesKhr, previewConfig)}
                tone="dark"
              />
              <SummaryTile
                icon={RotateCcw}
                label={copy('totalReturns', 'Returns total')}
                value={formatPortalPrice(membershipData.totals?.totalReturnsUsd, membershipData.totals?.totalReturnsKhr, previewConfig)}
                tone="amber"
              />
              <SummaryTile
                icon={Store}
                label={copy('membershipDiscountTotal', 'Membership discounts used')}
                value={formatPortalPrice(membershipData.totals?.membershipDiscountUsd, membershipData.totals?.membershipDiscountKhr, previewConfig)}
                tone="dark"
              />
              <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 sm:col-span-2">
                <div className="font-semibold">{copy('redeemRule', 'Points can be used in whole units only. Ask staff to apply them during checkout.')}</div>
                <div className="mt-2">{redeemSummaryText}</div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <SectionShell title={copy('purchaseHistory', 'Purchase history')} subtitle={copy('readOnly', 'Read-only for customers')}>
              <div className="space-y-3">
                {membershipData.sales?.length ? membershipData.sales.map((entry) => (
                  <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{entry.receipt_number || `#${entry.id}`}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(entry.created_at)}
                          {entry.branch_name ? ` | ${entry.branch_name}` : ''}
                        </div>
                      </div>
                      <StatusPill copy={copy} status={entry.payment_status === 'paid' ? 'in_stock' : 'low_stock'} />
                    </div>
                    <div className="mt-3 grid gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('items', 'Items')}</div>
                        <div className="mt-1 text-sm text-slate-700">{entry.items_summary || '-'}</div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('branchView', 'Branch view')}</div>
                          <div className="mt-1 text-sm text-slate-700">{entry.branch_name || '-'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('totalSales', 'Sales total')}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{formatPortalPrice(entry.total_usd, entry.total_khr, previewConfig)}</div>
                        </div>
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {copy('noSales', 'No sales found for this membership yet.')}
                  </div>
                )}
              </div>
            </SectionShell>

            <SectionShell title={copy('returnHistory', 'Return history')} subtitle={copy('readOnly', 'Read-only for customers')}>
              <div className="space-y-3">
                {membershipData.returns?.length ? membershipData.returns.map((entry) => (
                  <article key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{entry.return_number || `#${entry.id}`}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {formatDateTime(entry.created_at)}
                          {entry.branch_name ? ` | ${entry.branch_name}` : ''}
                        </div>
                      </div>
                      <StatusPill copy={copy} status={entry.status === 'cancelled' ? 'out_of_stock' : 'low_stock'} />
                    </div>
                    <div className="mt-3 grid gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('items', 'Items')}</div>
                        <div className="mt-1 text-sm text-slate-700">{entry.items_summary || '-'}</div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('reason', 'Reason')}</div>
                          <div className="mt-1 text-sm text-slate-700">{entry.reason || '-'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('refund', 'Refund')}</div>
                          <div className="mt-1 text-sm font-semibold text-slate-900">{formatPortalPrice(entry.total_refund_usd, entry.total_refund_khr, previewConfig)}</div>
                        </div>
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {copy('noReturns', 'No returns found for this membership yet.')}
                  </div>
                )}
              </div>
            </SectionShell>
          </div>

          <SectionShell title={copy('shareProofs', 'Share & reward')} subtitle={copy('shareProofsHint', 'Customers can submit screenshots showing they shared the business. Staff reviews and awards points inside Business OS.')}>
            <div className="grid gap-5 xl:grid-cols-[1.2fr,1fr]">
              <div className="space-y-4">
                {previewConfig.submissionInstructions ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <div className="font-semibold text-slate-900">{copy('submissionInstructions', 'Submission instructions')}</div>
                    <div className="mt-1">{previewConfig.submissionInstructions}</div>
                  </div>
                ) : null}
                {!previewConfig.submissionEnabled ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {copy('submissionDisabled', 'Share submissions are currently disabled.')}
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="portal-share-platform" className="block text-sm font-medium text-slate-700">{copy('sharePlatform', 'Platform')}</label>
                    <input id="portal-share-platform" name="share_platform" autoComplete="off" className="input" disabled={!previewConfig.submissionEnabled} value={submissionDraft.platform} placeholder={copy('sharePlatformPlaceholder', 'Facebook post, Instagram story, Telegram status...')} onChange={(event) => setSubmissionDraft((current) => ({ ...current, platform: event.target.value }))} />
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{copy('shareStatus', 'Status')}</div>
                    <div className="mt-2 font-medium text-slate-900">{copy('pending', 'Pending')}</div>
                  </div>
                </div>
                <div>
                  <label htmlFor="portal-share-note" className="block text-sm font-medium text-slate-700">{copy('shareNote', 'Customer note')}</label>
                  <textarea
                    id="portal-share-note"
                    name="share_note"
                    autoComplete="off"
                    className="input min-h-[120px] resize-none"
                    rows={5}
                    value={submissionDraft.note}
                    disabled={!previewConfig.submissionEnabled}
                    placeholder={copy('sharePaste', 'Paste screenshots here or upload below')}
                    onChange={(event) => setSubmissionDraft((current) => ({ ...current, note: event.target.value }))}
                    onPaste={handleSubmissionPaste}
                  />
                </div>
                <div className="flex flex-wrap gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
                  <button type="button" className="btn-secondary text-sm" disabled={!previewConfig.submissionEnabled} onClick={handleUploadSubmissionImages}>
                    <Upload className="mr-2 inline h-4 w-4" />
                    {copy('shareUpload', 'Upload screenshots')}
                  </button>
                  <button type="button" className="btn-primary text-sm" disabled={submissionSaving || !previewConfig.submissionEnabled} onClick={handleSubmitShareProof}>
                    {submissionSaving ? copy('shareSubmitting', 'Submitting...') : copy('shareSubmit', 'Submit for review')}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {submissionDraft.screenshots.map((image, index) => (
                    <div key={`${image.slice(0, 24)}-${index}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      <button
                        type="button"
                        className="block w-full"
                        onClick={() => openPortalImage(copy('shareProofs', 'Share & reward'), submissionDraft.screenshots, index)}
                      >
                        <img src={image} alt={`submission-${index + 1}`} className="h-36 w-full object-cover" />
                      </button>
                      <button
                        type="button"
                        className="w-full border-t border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-white"
                        onClick={() => setSubmissionDraft((current) => ({ ...current, screenshots: current.screenshots.filter((_, imageIndex) => imageIndex !== index) }))}
                      >
                        {copy('clearImage', 'Clear')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                {(membershipData?.submissions?.length || 0) ? membershipData.submissions.map((submission) => (
                  <article key={submission.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{submission.platform || copy('shareProofs', 'Share & reward')}</div>
                        <div className="mt-1 text-xs text-slate-500">{formatDateTime(submission.created_at)}</div>
                      </div>
                      <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                        {submission.status === 'approved'
                          ? copy('shareApproved', 'Approved')
                          : submission.status === 'rejected'
                            ? copy('shareRejected', 'Rejected')
                            : copy('sharePending', 'Pending review')}
                      </div>
                    </div>
                    {submission.note ? <p className="mt-3 text-sm text-slate-700">{submission.note}</p> : null}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(submission.screenshots || []).map((image, index) => (
                        <button
                          key={`${submission.id}-${index}`}
                          type="button"
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                          onClick={() => openPortalImage(submission.platform || copy('shareProofs', 'Share & reward'), submission.screenshots || [], index)}
                        >
                          <img src={image} alt={`submission-${submission.id}-${index + 1}`} className="h-28 w-full object-cover" />
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
                      <span>{copy('shareReward', 'Reward')}: {(submission.reward_points || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} pts</span>
                      {submission.review_note ? <span>{copy('shareReviewNote', 'Review note')}: {submission.review_note}</span> : null}
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {copy('noSubmissions', 'No share submissions yet.')}
                  </div>
                )}
              </div>
            </div>
          </SectionShell>
        </div>
      ) : null}
    </SectionShell>
  )
}

function CatalogAboutSection(props) {
  const {
    copy,
    previewConfig,
    mapEmbedUrl,
    addressFact,
    openPortalImage,
  } = props

  return (
    <SectionShell
      title={previewConfig.aboutTitle || copy('about', 'About')}
      subtitle={copy('portalAboutFallback', 'Add your business story in the editor so customers can quickly learn about your brand.')}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {previewConfig.aboutContent ? (
          <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6">
            <p className="whitespace-pre-line text-sm leading-7 text-slate-700">{previewConfig.aboutContent}</p>
          </div>
        ) : null}
        {previewConfig.aboutBlocks?.length ? previewConfig.aboutBlocks.map((block) => (
          <div key={block.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            {block.mediaUrl ? (
              <button
                type="button"
                className="flex w-full items-center justify-center bg-slate-50 p-4"
                onClick={() => openPortalImage(block.title || previewConfig.aboutTitle || copy('about', 'About'), [block.mediaUrl])}
              >
                {block.type === 'video' ? (
                  <video src={block.mediaUrl} controls preload="metadata" className="max-h-[340px] w-full rounded-2xl bg-white object-contain" />
                ) : (
                  <img src={block.mediaUrl} alt={block.title || previewConfig.aboutTitle || copy('about', 'About')} className="max-h-[340px] w-full rounded-2xl object-contain" />
                )}
              </button>
            ) : null}
            <div className="space-y-3 p-6">
              {block.title ? <h3 className="text-lg font-semibold text-slate-900">{block.title}</h3> : null}
              {block.body ? <p className="whitespace-pre-line text-sm leading-7 text-slate-700">{block.body}</p> : null}
            </div>
          </div>
        )) : null}
        {mapEmbedUrl ? (
          <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                <MapPin className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900">{copy('mapCard', 'Store map')}</div>
                {addressFact?.value ? <div className="text-xs text-slate-500">{addressFact.value}</div> : null}
              </div>
            </div>
            <iframe
              title="portal-about-map"
              src={mapEmbedUrl}
              className="h-64 w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : null}
        {!previewConfig.aboutContent && !previewConfig.aboutBlocks?.length && !mapEmbedUrl ? (
          <div className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6">
            <p className="text-sm text-slate-500">{copy('portalAboutFallback', 'Add your business story in the editor so customers can quickly learn about your brand.')}</p>
          </div>
        ) : null}
      </div>
    </SectionShell>
  )
}

function CatalogFaqSection(props) {
  const {
    copy,
    previewConfig,
    publicFaqItems,
    expandedFaqId,
    setExpandedFaqId,
  } = props

  return (
    <SectionShell
      title={previewConfig.faqTitle || copy('faq', 'FAQ')}
      subtitle={copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}
    >
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {publicFaqItems.length ? publicFaqItems.map((item, index) => {
          const open = expandedFaqId === item.id
          return (
            <article key={item.id || index} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
                onClick={() => setExpandedFaqId((current) => current === item.id ? null : item.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                    <HelpCircle className="h-4 w-4" />
                  </span>
                  <div className="text-sm font-semibold text-slate-900">{item.question}</div>
                </div>
                <span className="rounded-full bg-slate-100 p-2 text-slate-500">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
              </button>
              {open ? <div className="border-t border-slate-100 px-5 py-4 text-sm leading-7 text-slate-600">{item.answer}</div> : null}
            </article>
          )
        }) : (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            {copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}
          </div>
        )}
      </div>
    </SectionShell>
  )
}

function CatalogAiSection(props) {
  const {
    copy,
    previewConfig,
    brands,
    assistantProfile,
    setAssistantProfile,
    assistantCategoryOptions,
    assistantQuestion,
    setAssistantQuestion,
    questionCharLimit,
    askAssistant,
    assistantLoading,
    clearAssistantState,
    aiUsageSummary,
    assistantRequestPolicy,
    replaceVars,
    assistantError,
    assistantResponse,
    assistantExpandedProductId,
    setAssistantExpandedProductId,
  } = props

  return (
    <SectionShell
      title={previewConfig.aiTitle || copy('portalAssistant', 'AI assistant')}
      subtitle={previewConfig.aiIntro || copy('assistantNotice', 'AI generated, for reference only.')}
      action={(
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
          <Bot className="h-3.5 w-3.5" />
          AI query
        </span>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantBrand', 'Preferred brand')}</label>
                <select className="input mt-1" value={assistantProfile.brand} onChange={(event) => setAssistantProfile((current) => ({ ...current, brand: event.target.value }))}>
                  <option value="">{copy('all', 'All')}</option>
                  {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantSkinType', 'Skin type')}</label>
                <select className="input mt-1" value={assistantProfile.skinType} onChange={(event) => setAssistantProfile((current) => ({ ...current, skinType: event.target.value }))}>
                  <option value="">{copy('all', 'All')}</option>
                  {['Dry', 'Oily', 'Combination', 'Sensitive', 'Normal', 'Acne-prone'].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantShoppingFor', 'Shopping for')}</label>
                <select className="input mt-1" value={assistantProfile.shoppingFor} onChange={(event) => setAssistantProfile((current) => ({ ...current, shoppingFor: event.target.value }))}>
                  <option value="">{copy('all', 'All')}</option>
                  {assistantCategoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">{copy('assistantGoal', 'Goal / use case')}</label>
                <input className="input mt-1" maxLength={180} value={assistantProfile.goal} onChange={(event) => setAssistantProfile((current) => ({ ...current, goal: event.target.value }))} placeholder="Daily use, brightening, long wear..." />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-sm font-medium text-slate-700">{copy('assistantConcerns', 'Skin concerns')}</label>
              <input className="input mt-1" maxLength={220} value={assistantProfile.concerns} onChange={(event) => setAssistantProfile((current) => ({ ...current, concerns: event.target.value }))} placeholder="Acne, sensitivity, dark spots, dryness..." />
            </div>

            <div className="mt-3">
              <label className="block text-sm font-medium text-slate-700">{copy('assistantQuestion', 'What would you like help finding?')}</label>
              <textarea className="input mt-1 resize-none" rows={5} maxLength={questionCharLimit} value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} placeholder={copy('assistantQuestionPlaceholder', 'Example: I have oily acne-prone skin and want a gentle daily sunscreen.')} />
              <div className="mt-1 text-right text-xs text-slate-500">{assistantQuestion.length}/{questionCharLimit}</div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary text-sm" onClick={askAssistant} disabled={assistantLoading}>
                <Send className="mr-2 inline h-4 w-4" />
                {assistantLoading ? copy('assistantLoading', 'Thinking...') : copy('askAssistant', 'Ask AI assistant')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={clearAssistantState}>
                <RotateCcw className="mr-2 inline h-4 w-4" />
                {copy('assistantReset', 'Clear')}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-600">
              {replaceVars(copy('assistantUsageCompact', '{users} user(s) are using this right now. Each visitor can send {searches} search(es) per minute.'), {
                users: aiUsageSummary?.activeVisitors || 1,
                searches: assistantRequestPolicy?.perUserPerMinute || aiUsageSummary?.perUserPerMinute || 1,
              })}
            </div>

            <div className="rounded-[28px] border border-amber-200 bg-amber-50 px-4 py-4 text-xs leading-6 text-amber-900">
              {previewConfig.aiDisclaimer || copy('assistantNotice', 'AI generated, for reference only.')}
            </div>
          </div>
        </div>

        {assistantError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{assistantError}</div> : null}

        {assistantResponse?.summary ? (
          <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('assistantResults', 'Suggested matches')}</div>
            <p className="mt-2 text-sm leading-7 text-slate-700">{assistantResponse.summary}</p>
            {assistantResponse.followUpQuestions?.length ? (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('assistantFollowUps', 'Helpful follow-up questions')}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {assistantResponse.followUpQuestions.map((question) => (
                    <button key={question} type="button" className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm" onClick={() => setAssistantQuestion(question)}>
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {assistantResponse?.recommendations?.length ? (
          <div className="space-y-3">
            {assistantResponse.recommendations.map((item) => {
              const open = assistantExpandedProductId === item.product_id
              return (
                <article key={item.product_id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <button type="button" className="flex w-full items-start gap-3 px-4 py-4 text-left" onClick={() => setAssistantExpandedProductId((current) => current === item.product_id ? null : item.product_id)}>
                    {item.image_path ? (
                      <img src={item.image_path} alt={item.name} className="h-16 w-16 rounded-2xl object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                        <ShoppingBag className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-slate-900">{item.name}</div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">{item.brand || 'No brand'}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{item.category || 'No category'} | {previewConfig.priceDisplay === 'KHR' ? `${item.selling_price_khr || 0} KHR` : `$${Number(item.selling_price_usd || 0).toFixed(2)}`}</div>
                      {item.reason ? <div className="mt-2 text-sm text-slate-600">{item.reason}</div> : null}
                    </div>
                    <span className="rounded-full bg-slate-100 p-2 text-slate-500">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                  </button>
                  {open ? (
                    <div className="border-t border-slate-100 px-4 py-4 text-sm text-slate-700">
                      {item.fit_summary ? <div><span className="font-semibold text-slate-900">{copy('assistantWhy', 'Why this match')}:</span> {item.fit_summary}</div> : null}
                      {item.how_to_use ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantUse', 'How to use')}:</span> {item.how_to_use}</div> : null}
                      {item.cautions ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantCaution', 'Caution')}:</span> {item.cautions}</div> : null}
                      {item.ingredients_focus?.length ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantIngredients', 'Ingredients focus')}:</span> {item.ingredients_focus.join(', ')}</div> : null}
                      {item.online_review_summary ? <div className="mt-2"><span className="font-semibold text-slate-900">{copy('assistantReviews', 'Online review summary')}:</span> {item.online_review_summary}</div> : null}
                      {item.online_references?.length ? (
                        <div className="mt-3">
                          <div className="font-semibold text-slate-900">{copy('assistantEvidence', 'Online references')}:</div>
                          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                            {item.online_references.map((reference, index) => (
                              <li key={`${item.product_id}-${index}`}>
                                {reference.url ? <a href={reference.url} target="_blank" rel="noreferrer" className="text-cyan-700 underline">{reference.title || reference.url}</a> : (reference.title || reference.snippet || 'Reference')}
                                {reference.snippet ? <span className="text-slate-500"> - {reference.snippet}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : null}
      </div>
    </SectionShell>
  )
}

export default function CatalogSecondaryTabs({ tab, ...props }) {
  if (tab === 'membership') return <CatalogMembershipSection {...props} />
  if (tab === 'about') return <CatalogAboutSection {...props} />
  if (tab === 'faq') return <CatalogFaqSection {...props} />
  if (tab === 'ai') return <CatalogAiSection {...props} />
  return null
}

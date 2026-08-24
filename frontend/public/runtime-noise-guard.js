/*
 * Generated from frontend/src/public-runtime/*.ts.
 * Run: npm.cmd --prefix frontend run build:public-runtime
 */
(function installBusinessOsRuntimeNoiseGuard() {
    if (typeof window === 'undefined')
        return;
    const runtimeWindow = window;
    if (runtimeWindow.__businessOsRuntimeNoiseGuard)
        return;
    runtimeWindow.__businessOsRuntimeNoiseGuard = true;
    const extensionSourcePattern = /(chrome-extension|moz-extension|safari-extension|ms-browser-extension):\/\//i;
    const injectedSourcePattern = /\bVM\d+\s+(vendor|content|components|inpage)\.js\b|(^|\s)(vendor|content|components|inpage|grammarly-check)\.js(?::\d+){0,2}(?=\s|$)/i;
    const firstPartyAssetPattern = /\/assets\/[^?#]+\.(js|css)$/i;
    function text(value) {
        return String(value || '');
    }
    function sourceFromEvent(event) {
        const target = event.target;
        return [
            text('filename' in event ? event.filename : ''),
            text(target && ('src' in target ? target.src : target.href)),
            text('error' in event ? event.error?.stack : ''),
            text('reason' in event ? event.reason?.stack : ''),
        ].join('\n');
    }
    function isFirstPartyAsset(source) {
        return firstPartyAssetPattern.test(text(source));
    }
    function isInjectedSource(source) {
        const raw = text(source);
        return !isFirstPartyAsset(raw) && (extensionSourcePattern.test(raw) || injectedSourcePattern.test(raw));
    }
    function isKnownNoise(message, source) {
        const rawMessage = text(message);
        const rawSource = text(source);
        if (/tabs:outgoing\.message\.ready|No Listener:\s*tabs:outgoing|Receiving end does not exist|Could not establish connection/i.test(rawMessage))
            return true;
        if (/cssRules|insertRule/i.test(rawMessage) && /Cannot read properties|Failed to access|\bnull\b/i.test(rawMessage)) {
            return isInjectedSource(rawSource || rawMessage);
        }
        if (/unsafe-eval|Evaluating a string as JavaScript violates|Content Security Policy of your site blocks the use of 'eval'/i.test(rawMessage)) {
            return isInjectedSource(rawSource || rawMessage);
        }
        return false;
    }
    function suppress(event, value) {
        const maybeError = value;
        const message = text(maybeError && maybeError.message ? maybeError.message : value);
        const source = sourceFromEvent(event);
        if (!isKnownNoise(message, source))
            return false;
        try {
            event.preventDefault();
        }
        catch (_) { }
        try {
            event.stopImmediatePropagation();
        }
        catch (_) { }
        return true;
    }
    window.addEventListener('unhandledrejection', function onUnhandledRejection(event) {
        suppress(event, event.reason);
    }, true);
    window.addEventListener('error', function onError(event) {
        suppress(event, event.error || event.message);
    }, true);
    window.addEventListener('securitypolicyviolation', function onSecurityPolicyViolation(event) {
        const sourceFile = text(event.sourceFile);
        const sample = text(event.sample);
        const blockedUri = text(event.blockedURI);
        if (!(isKnownNoise(sample, sourceFile) || (blockedUri === 'eval' && isInjectedSource(sourceFile))))
            return;
        try {
            event.stopImmediatePropagation();
        }
        catch (_) { }
    }, true);
    const sheetPrototype = window.CSSStyleSheet && window.CSSStyleSheet.prototype;
    if (!sheetPrototype)
        return;
    const nativeInsertRule = sheetPrototype.insertRule;
    if (typeof nativeInsertRule === 'function' && !nativeInsertRule.__businessOsGuarded) {
        const guardedInsertRule = function guardedInsertRule(rule, index) {
            try {
                return nativeInsertRule.call(this, rule, index);
            }
            catch (error) {
                if (isKnownNoise(error?.message, 'VM vendor.js'))
                    return -1;
                throw error;
            }
        };
        guardedInsertRule.__businessOsGuarded = true;
        sheetPrototype.insertRule = guardedInsertRule;
    }
    const descriptor = Object.getOwnPropertyDescriptor(sheetPrototype, 'cssRules');
    const nativeCssRulesGetter = descriptor?.get;
    if (descriptor && nativeCssRulesGetter && !nativeCssRulesGetter.__businessOsGuarded) {
        const guardedCssRulesGetter = function guardedCssRulesGetter() {
            try {
                return nativeCssRulesGetter.call(this) || [];
            }
            catch (error) {
                if (isKnownNoise(error?.message, 'VM vendor.js'))
                    return [];
                throw error;
            }
        };
        guardedCssRulesGetter.__businessOsGuarded = true;
        Object.defineProperty(sheetPrototype, 'cssRules', {
            configurable: true,
            enumerable: descriptor.enumerable,
            get: guardedCssRulesGetter,
        });
    }
}());

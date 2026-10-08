import { createHash } from 'node:crypto';
import { z } from 'zod';
export const LIMITS = Object.freeze({
    depth: 12,
    nodes: 20_000,
    keys: 100,
    array: 256,
    string: 16_000,
    dispatchBytes: 2_048,
    workBytes: 262_144,
    outcomeBytes: 262_144,
    payloadBytes: 32_768,
    checkpointBytes: 65_536,
    observationBytes: 16_384,
});
/** JSON-domain only. No toJSON, getters, prototypes, sparse arrays or coercion. */
export function canonicalJson(value, maxBytes = LIMITS.outcomeBytes) {
    const active = new Set();
    let nodes = 0;
    let estimatedBytes = 0;
    function visit(v, depth) {
        if (++nodes > LIMITS.nodes || depth > LIMITS.depth)
            throw new TypeError('JSON structure limit');
        if (v === null)
            return 'null';
        if (typeof v === 'boolean')
            return String(v);
        if (typeof v === 'number') {
            if (!Number.isFinite(v) ||
                Object.is(v, -0) ||
                (Number.isInteger(v) && !Number.isSafeInteger(v)))
                throw new TypeError('Unsafe JSON number');
            return JSON.stringify(v);
        }
        if (typeof v === 'string') {
            if (v.length > LIMITS.string || !v.isWellFormed())
                throw new TypeError('Unsafe JSON string');
            estimatedBytes += Buffer.byteLength(v);
            if (estimatedBytes > maxBytes)
                throw new TypeError('JSON byte limit');
            return JSON.stringify(v);
        }
        if (typeof v !== 'object')
            throw new TypeError('Non-JSON value');
        if (active.has(v))
            throw new TypeError('Cyclic JSON');
        const array = Array.isArray(v);
        if (!array &&
            Object.getPrototypeOf(v) !== Object.prototype &&
            Object.getPrototypeOf(v) !== null)
            throw new TypeError('Non-JSON object');
        const keys = Reflect.ownKeys(v);
        if (keys.some((k) => typeof k !== 'string'))
            throw new TypeError('Symbol key');
        active.add(v);
        let out;
        if (array) {
            if (v.length > LIMITS.array || keys.length !== v.length + 1)
                throw new TypeError('Unsafe JSON array');
            const parts = [];
            for (let i = 0; i < v.length; i++) {
                const d = Object.getOwnPropertyDescriptor(v, String(i));
                if (!d || !('value' in d) || !d.enumerable)
                    throw new TypeError('Unsafe JSON property');
                parts.push(visit(d.value, depth + 1));
            }
            out = `[${parts.join(',')}]`;
        }
        else {
            if (keys.length > LIMITS.keys)
                throw new TypeError('JSON key limit');
            out = `{${keys
                .sort()
                .map((k) => {
                if (['__proto__', 'prototype', 'constructor'].includes(k))
                    throw new TypeError('Unsafe JSON key');
                const d = Object.getOwnPropertyDescriptor(v, k);
                if (!d || !('value' in d) || !d.enumerable)
                    throw new TypeError('Unsafe JSON property');
                return `${visit(k, depth + 1)}:${visit(d.value, depth + 1)}`;
            })
                .join(',')}}`;
        }
        active.delete(v);
        return out;
    }
    const out = visit(value, 0);
    if (Buffer.byteLength(out) > maxBytes)
        throw new TypeError('JSON byte limit');
    return out;
}
export function digest(value) {
    return createHash('sha256')
        .update(canonicalJson(value), 'utf8')
        .digest('hex');
}
export function digestWithout(value, key) {
    canonicalJson(value);
    return digest(Object.fromEntries(Object.entries(value).filter(([k]) => k !== key)));
}
export function bounded(schema, maxBytes) {
    return z
        .unknown()
        .superRefine((v, ctx) => {
        try {
            canonicalJson(v, maxBytes);
        }
        catch {
            ctx.addIssue({ code: 'custom', message: 'Unsafe or oversized JSON' });
        }
    })
        .pipe(schema);
}
export const JsonPayloadSchema = bounded(z.json(), LIMITS.payloadBytes);
//# sourceMappingURL=json.js.map
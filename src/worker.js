import { importPKCS8, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';

// ── Google OAuth2 access token (service account) ─────────────────────────────

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken(sa) {
    if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

    const privateKey = await importPKCS8(sa.private_key, 'RS256');
    const now = Math.floor(Date.now() / 1000);

    const assertion = await new SignJWT({
        scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/datastore',
    })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(sa.client_email)
        .setSubject(sa.client_email)
        .setAudience('https://oauth2.googleapis.com/token')
        .setIssuedAt(now)
        .setExpirationTime(now + 3600)
        .sign(privateKey);

    const body = new URLSearchParams();
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    body.set('assertion', assertion);
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
    _cachedToken = data.access_token;
    _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _cachedToken;
}

// ── Firebase ID token verification ───────────────────────────────────────────

const JWKS = createRemoteJWKSet(
    new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

async function verifyIdToken(token, projectId) {
    const { payload } = await jwtVerify(token, JWKS, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
    });
    const uid = payload.user_id || payload.sub || '';
    if (!uid) throw new Error('Verified token did not include a Firebase uid.');
    return { ...payload, uid };
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

function fsUrl(projectId, path) {
    return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
}

function parseFirestoreDoc(doc) {
    if (!doc || !doc.fields) return null;
    const out = {};
    for (const [k, v] of Object.entries(doc.fields)) {
        if (v.stringValue !== undefined) out[k] = v.stringValue;
        else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
        else if (v.booleanValue !== undefined) out[k] = v.booleanValue;
        else if (v.timestampValue !== undefined) out[k] = v.timestampValue;
        else out[k] = v;
    }
    return out;
}

async function fsGet(projectId, token, collection, docId) {
    const res = await fetch(fsUrl(projectId, `${collection}/${docId}`), {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Firestore GET ${collection}/${docId} failed: ${res.status}`);
    return await res.json();
}

async function fsDelete(projectId, token, collection, docId) {
    const res = await fetch(fsUrl(projectId, `${collection}/${docId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Firestore DELETE failed: ${res.status}`);
}

async function fsQuery(projectId, token, collection, field, value) {
    const res = await fetch(
        `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structuredQuery: {
                    from: [{ collectionId: collection }],
                    where: {
                        fieldFilter: {
                            field: { fieldPath: field },
                            op: 'EQUAL',
                            value: { stringValue: value },
                        },
                    },
                },
            }),
        }
    );
    if (!res.ok) throw new Error(`Firestore query failed: ${res.status}`);
    const results = await res.json();
    return results.filter(r => r.document).map(r => r.document);
}

async function fsPatch(projectId, token, collection, docId, fields) {
    const firestoreFields = {};
    for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string') firestoreFields[k] = { stringValue: v };
        else if (typeof v === 'number') firestoreFields[k] = { integerValue: String(v) };
        else if (typeof v === 'boolean') firestoreFields[k] = { booleanValue: v };
        else if (v === null) continue;
        else if (v && typeof v === 'object' && v._type === 'timestamp') {
            firestoreFields[k] = { timestampValue: new Date().toISOString() };
        }
    }
    const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const res = await fetch(`${fsUrl(projectId, `${collection}/${docId}`)}?${updateMask}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: firestoreFields }),
    });
    if (!res.ok) throw new Error(`Firestore PATCH failed: ${res.status}`);
}

// ── Firebase Auth REST helpers ────────────────────────────────────────────────

async function authGetUser(projectId, token, uid) {
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts/${uid}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Auth getUser failed: ${res.status}`);
    return await res.json();
}

async function authGetUserByEmail(projectId, token, email) {
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: [email] }),
        }
    );
    if (!res.ok) throw new Error(`Auth getUserByEmail failed: ${res.status}`);
    const data = await res.json();
    if (!data.users || data.users.length === 0) {
        const err = new Error('No user found');
        err.code = 'auth/user-not-found';
        throw err;
    }
    return data.users[0];
}

async function authDeleteUser(projectId, token, uid) {
    const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts/${uid}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok && res.status !== 404) throw new Error(`Auth deleteUser failed: ${res.status}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(statusCode, body) {
    return new Response(JSON.stringify(body), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
    });
}

function getBearerToken(request) {
    const authHeader = request.headers.get('Authorization') || '';
    return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
}

function getServiceAccount(env) {
    let sa = env.FIREBASE_SERVICE_ACCOUNT;
    if (!sa) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable.');
    if (typeof sa === 'string') sa = JSON.parse(sa);
    return sa;
}

function getCloudinaryConfig(env) {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || 'dfagopgyv').trim();
    const apiKey = String(env.CLOUDINARY_API_KEY || '').trim();
    const apiSecret = String(env.CLOUDINARY_API_SECRET || '').trim();
    if (!cloudName) throw new Error('Missing Cloudinary cloud name.');
    if (!apiKey || !apiSecret) throw new Error('Missing Cloudinary API credentials.');
    return { cloudName, apiKey, apiSecret };
}

async function sha1Hex(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-1', data);
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

function deriveCloudinaryPublicId(url, cloudName = '') {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (cloudName && !parsed.hostname.includes(cloudName)) return '';
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const uploadIndex = pathParts.indexOf('upload');
        if (uploadIndex === -1) return '';

        let assetParts = pathParts.slice(uploadIndex + 1);
        const versionIndex = assetParts.findIndex(part => /^v\d+$/.test(part));
        if (versionIndex >= 0) assetParts = assetParts.slice(versionIndex + 1);
        if (assetParts.length === 0) return '';

        assetParts[assetParts.length - 1] = assetParts[assetParts.length - 1].replace(/\.[^.]+$/, '');
        return assetParts.join('/');
    } catch {
        return '';
    }
}

function resolveCloudinaryPublicId(preferredId, fallbackUrl, cloudName) {
    return String(preferredId || '').trim() || deriveCloudinaryPublicId(fallbackUrl, cloudName);
}

async function deleteCloudinaryAsset(env, publicId) {
    if (!publicId) return { deleted: false, result: 'skipped' };

    const { cloudName, apiKey, apiSecret } = getCloudinaryConfig(env);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await sha1Hex(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`);
    const body = new URLSearchParams();
    body.set('public_id', publicId);
    body.set('timestamp', String(timestamp));
    body.set('api_key', apiKey);
    body.set('signature', signature);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Cloudinary destroy failed: ${response.status} ${JSON.stringify(data)}`);
    }

    const result = String(data.result || '').toLowerCase();
    if (!['ok', 'not found', 'already deleted'].includes(result)) {
        throw new Error(`Cloudinary destroy returned "${data.result || 'unknown'}" for ${publicId}.`);
    }

    return { deleted: result === 'ok', result };
}

async function requireUser(request, env) {
    const token = getBearerToken(request);
    if (!token) return { error: json(401, { error: 'Missing bearer token.' }) };

    const sa = getServiceAccount(env);
    const decoded = await verifyIdToken(token, sa.project_id);
    const accessToken = await getAccessToken(sa);
    const callerDoc = await fsGet(sa.project_id, accessToken, 'users', decoded.uid);
    const callerData = parseFirestoreDoc(callerDoc) || {};

    return {
        sa,
        accessToken,
        decoded,
        projectId: sa.project_id,
        callerDoc,
        callerData,
        callerRole: callerData.role || 'client',
    };
}

async function requireAdmin(request, env) {
    const ctx = await requireUser(request, env);
    if (ctx.error) return ctx;

    const { callerData } = ctx;
    if (!callerData || callerData.role !== 'admin') {
        return { error: json(403, { error: 'Admin access required.' }) };
    }

    return ctx;
}

function canManageProduct(callerRole, callerUid, productData) {
    if (!callerUid || !productData) return false;
    return callerRole === 'admin' || callerRole === 'designer' || productData.ownerUid === callerUid;
}

// ── Delete User ───────────────────────────────────────────────────────────────

async function handleDeleteUser(request, env) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    let payload;
    try { payload = JSON.parse(await request.text() || '{}'); }
    catch { return json(400, { error: 'Invalid JSON body.' }); }

    const mode = String(payload.mode || 'delete').trim().toLowerCase();
    const uid = String(payload.uid || '').trim();
    const transferToUid = String(payload.transferToUid || '').trim();

    if (!uid) return json(400, { error: 'User uid is required.' });
    if (!['inspect', 'delete'].includes(mode)) return json(400, { error: 'Invalid mode.' });

    let ctx;
    try { ctx = await requireAdmin(request, env); if (ctx.error) return ctx.error; }
    catch (e) { return json(401, { error: e.message || 'Invalid admin session.' }); }

    const { sa, accessToken, decoded, projectId } = ctx;
    if (uid === decoded.uid) return json(400, { error: 'You cannot delete your own admin account here.' });

    try {
        const userDoc = await fsGet(projectId, accessToken, 'users', uid);
        const userData = parseFirestoreDoc(userDoc);
        const authUser = await authGetUser(projectId, accessToken, uid);

        if (!userDoc && !authUser) return json(404, { error: 'User not found.' });
        if (userData?.role === 'admin') return json(400, { error: 'Admin accounts cannot be deleted from this panel.' });

        const email = userData?.email || authUser?.email || uid;

        const products = await fsQuery(projectId, accessToken, 'products', 'ownerUid', uid);
        const categories = await fsQuery(projectId, accessToken, 'categories', 'ownerUid', uid);
        const productsCount = products.length;
        const categoriesCount = categories.length;

        if (mode === 'inspect') {
            return json(200, {
                ok: true, uid, email, role: userData?.role || 'client',
                productsCount, categoriesCount,
                transferRequired: productsCount > 0 || categoriesCount > 0,
                existsInAuth: Boolean(authUser), existsInUsers: Boolean(userDoc),
            });
        }

        let transferEmail = '';
        if (productsCount > 0 || categoriesCount > 0) {
            if (!transferToUid) return json(400, { error: 'This user still owns data. Transfer target is required.' });
            if (transferToUid === uid) return json(400, { error: 'Transfer target must be a different user.' });

            const transferDoc = await fsGet(projectId, accessToken, 'users', transferToUid);
            const transferAuth = await authGetUser(projectId, accessToken, transferToUid);
            if (!transferDoc && !transferAuth) return json(404, { error: 'Transfer target not found.' });
            transferEmail = parseFirestoreDoc(transferDoc)?.email || transferAuth?.email || transferToUid;

            const now = new Date().toISOString();
            const allDocs = [...products, ...categories];
            for (const doc of allDocs) {
                const parts = doc.name.split('/');
                const collection = parts[parts.length - 3];
                const docId = parts[parts.length - 1];
                await fsPatch(projectId, accessToken, collection, docId, {
                    ownerUid: transferToUid, ownerEmail: transferEmail,
                    transferredAt: { _type: 'timestamp' }, transferredBy: decoded.uid,
                    updatedAt: { _type: 'timestamp' },
                });
            }
        }

        if (userDoc) await fsDelete(projectId, accessToken, 'users', uid);
        if (authUser) await authDeleteUser(projectId, accessToken, uid);

        return json(200, {
            ok: true, uid, email, deleted: true,
            transferred: Boolean(transferEmail),
            transferToUid: transferToUid || '', transferToEmail: transferEmail,
            productsCount, categoriesCount,
        });
    } catch (e) {
        console.error('[delete-user]', e);
        return json(500, { error: e.message || 'Delete user failed.' });
    }
}

// ── Repair User ───────────────────────────────────────────────────────────────

async function handleRepairUser(request, env) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    let payload;
    try { payload = JSON.parse(await request.text() || '{}'); }
    catch { return json(400, { error: 'Invalid JSON body.' }); }

    const email = String(payload.email || '').trim().toLowerCase();
    const requestedRole = String(payload.role || 'client').trim().toLowerCase();
    if (!email) return json(400, { error: 'Email is required.' });
    if (!['admin', 'client'].includes(requestedRole)) return json(400, { error: 'Invalid role.' });

    let ctx;
    try { ctx = await requireAdmin(request, env); if (ctx.error) return ctx.error; }
    catch (e) { return json(401, { error: e.message || 'Invalid admin session.' }); }

    const { sa, accessToken, decoded, projectId } = ctx;

    try {
        const authUser = await authGetUserByEmail(projectId, accessToken, email);
        const userDoc = await fsGet(projectId, accessToken, 'users', authUser.localId);
        const existingData = parseFirestoreDoc(userDoc);
        const role = existingData?.role || requestedRole;
        const now = new Date().toISOString();

        const fields = {
            email: authUser.email || email, role,
            repairedAt: { _type: 'timestamp' }, repairedBy: decoded.uid,
            updatedAt: { _type: 'timestamp' },
        };
        if (!userDoc) {
            fields.createdAt = { _type: 'timestamp' };
            fields.createdBy = decoded.uid;
        }

        await fsPatch(projectId, accessToken, 'users', authUser.localId, fields);
        return json(200, { ok: true, uid: authUser.localId, email: authUser.email || email, role, existed: Boolean(userDoc) });
    } catch (e) {
        if (e.code === 'auth/user-not-found') return json(404, { error: 'No Firebase Auth account found for that email.' });
        console.error('[repair-user]', e);
        return json(500, { error: e.message || 'Repair failed.' });
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function getProductAssetIds(productData, env) {
    const cloudName = String(env.CLOUDINARY_CLOUD_NAME || 'dfagopgyv').trim();
    const originalPublicId = resolveCloudinaryPublicId(
        productData?.originalImagePublicId,
        productData?.originalImageUrl || productData?.imageUrl || '',
        cloudName
    );
    const editedPublicId = resolveCloudinaryPublicId(
        productData?.editedImagePublicId,
        productData?.editedImageUrl || '',
        cloudName
    );
    return { originalPublicId, editedPublicId };
}

async function deleteProductAssets(env, productData, options = {}) {
    const { editedOnly = false } = options;
    const { originalPublicId, editedPublicId } = getProductAssetIds(productData, env);
    const assetIds = editedOnly ? [editedPublicId] : [editedPublicId, originalPublicId];
    const uniqueAssetIds = [...new Set(assetIds.filter(Boolean))];
    const results = [];

    for (const publicId of uniqueAssetIds) {
        results.push({
            publicId,
            ...(await deleteCloudinaryAsset(env, publicId)),
        });
    }

    return results;
}

async function handleDeleteProduct(request, env) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    let payload;
    try { payload = JSON.parse(await request.text() || '{}'); }
    catch { return json(400, { error: 'Invalid JSON body.' }); }

    const productId = String(payload.productId || '').trim();
    if (!productId) return json(400, { error: 'Product id is required.' });

    let ctx;
    try { ctx = await requireUser(request, env); if (ctx.error) return ctx.error; }
    catch (e) { return json(401, { error: e.message || 'Invalid session.' }); }

    const { accessToken, decoded, projectId, callerRole } = ctx;

    try {
        const productDoc = await fsGet(projectId, accessToken, 'products', productId);
        const productData = parseFirestoreDoc(productDoc);
        if (!productDoc || !productData) return json(404, { error: 'Product not found.' });
        if (!canManageProduct(callerRole, decoded.uid, productData)) {
            return json(403, { error: 'You do not have permission to delete this product.' });
        }

        const assetResults = await deleteProductAssets(env, productData);
        await fsDelete(projectId, accessToken, 'products', productId);

        return json(200, {
            ok: true,
            productId,
            deleted: true,
            deletedAssets: assetResults,
        });
    } catch (e) {
        console.error('[delete-product]', e);
        return json(500, { error: e.message || 'Delete product failed.' });
    }
}

async function handleDeleteEditedImage(request, env) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    let payload;
    try { payload = JSON.parse(await request.text() || '{}'); }
    catch { return json(400, { error: 'Invalid JSON body.' }); }

    const productId = String(payload.productId || '').trim();
    if (!productId) return json(400, { error: 'Product id is required.' });

    let ctx;
    try { ctx = await requireUser(request, env); if (ctx.error) return ctx.error; }
    catch (e) { return json(401, { error: e.message || 'Invalid session.' }); }

    const { accessToken, decoded, projectId, callerRole } = ctx;

    try {
        const productDoc = await fsGet(projectId, accessToken, 'products', productId);
        const productData = parseFirestoreDoc(productDoc);
        if (!productDoc || !productData) return json(404, { error: 'Product not found.' });
        if (!canManageProduct(callerRole, decoded.uid, productData)) {
            return json(403, { error: 'You do not have permission to update this product.' });
        }

        const originalImageUrl = productData.originalImageUrl || productData.imageUrl || '';
        if (!productData.editedImageUrl && !productData.editedImagePublicId) {
            return json(200, { ok: true, productId, deletedAssets: [], updated: false });
        }

        const assetResults = await deleteProductAssets(env, productData, { editedOnly: true });
        await fsPatch(projectId, accessToken, 'products', productId, {
            editedImageUrl: null,
            editedImagePublicId: null,
            currentImageUrl: originalImageUrl,
            imageUrl: originalImageUrl,
            imageStatus: 'raw',
            editedBy: null,
            editedAt: null,
            updatedAt: { _type: 'timestamp' },
        });

        return json(200, {
            ok: true,
            productId,
            updated: true,
            deletedAssets: assetResults,
        });
    } catch (e) {
        console.error('[delete-edited-image]', e);
        return json(500, { error: e.message || 'Delete edited image failed.' });
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (!url.pathname.startsWith('/api/')) {
            return env.ASSETS.fetch(request);
        }

        try {
            if (url.pathname === '/api/delete-user-account') return handleDeleteUser(request, env);
            if (url.pathname === '/api/repair-user-by-email') return handleRepairUser(request, env);
            if (url.pathname === '/api/delete-product') return handleDeleteProduct(request, env);
            if (url.pathname === '/api/delete-product-edited-image') return handleDeleteEditedImage(request, env);
            return json(404, { error: 'Not found.' });
        } catch (e) {
            return json(500, { error: e.message || 'Internal server error.' });
        }
    },
};

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

function getServiceAccount(env) {
    let sa = env.FIREBASE_SERVICE_ACCOUNT;
    if (!sa) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable.');
    if (typeof sa === 'string') sa = JSON.parse(sa);
    return sa;
}

async function requireAdmin(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return { error: json(401, { error: 'Missing bearer token.' }) };

    const sa = getServiceAccount(env);
    const decoded = await verifyIdToken(token, sa.project_id);
    const accessToken = await getAccessToken(sa);

    const callerDoc = await fsGet(sa.project_id, accessToken, 'users', decoded.uid);
    const callerData = parseFirestoreDoc(callerDoc);
    if (!callerData || callerData.role !== 'admin') {
        return { error: json(403, { error: 'Admin access required.' }) };
    }

    return { sa, accessToken, decoded, projectId: sa.project_id };
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (!url.pathname.startsWith('/api/')) {
            return env.ASSETS.fetch(request);
        }

        try {
            if (url.pathname === '/api/delete-user-account') return handleDeleteUser(request, env);
            if (url.pathname === '/api/repair-user-by-email') return handleRepairUser(request, env);
            return json(404, { error: 'Not found.' });
        } catch (e) {
            return json(500, { error: e.message || 'Internal server error.' });
        }
    },
};

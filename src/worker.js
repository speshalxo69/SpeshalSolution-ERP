// ── Helpers ──────────────────────────────────────────────────────────────────

function json(statusCode, body) {
    return new Response(JSON.stringify(body), {
        status: statusCode,
        headers: { 'Content-Type': 'application/json' },
    });
}

let _adminApp = null;

async function getAdminApp(env) {
    if (_adminApp) return _adminApp;
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    if (getApps().length > 0) { _adminApp = getApps()[0]; return _adminApp; }
    let serviceAccount = env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccount) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT environment variable.');
    if (typeof serviceAccount === 'string') serviceAccount = JSON.parse(serviceAccount);
    _adminApp = initializeApp({ credential: cert(serviceAccount) });
    return _adminApp;
}

async function requireAdmin(request, env) {
    const { getAuth } = await import('firebase-admin/auth');
    const { getFirestore } = await import('firebase-admin/firestore');
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return { error: json(401, { error: 'Missing bearer token.' }) };

    const app = await getAdminApp(env);
    const adminAuth = getAuth(app);
    const adminDb = getFirestore(app);

    const decoded = await adminAuth.verifyIdToken(token);
    const callerDoc = await adminDb.collection('users').doc(decoded.uid).get();
    const callerRole = callerDoc.exists ? callerDoc.data()?.role : null;
    if (callerRole !== 'admin') return { error: json(403, { error: 'Admin access required.' }) };
    return { adminAuth, adminDb, decoded };
}

async function getAuthUserSafe(adminAuth, uid) {
    try { return await adminAuth.getUser(uid); }
    catch (error) { if (error.code === 'auth/user-not-found') return null; throw error; }
}

async function resolveUserIdentity(adminAuth, adminDb, uid) {
    const userDoc = await adminDb.collection('users').doc(uid).get();
    const authUser = await getAuthUserSafe(adminAuth, uid);
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};
    return {
        uid, existsInUsers: userDoc.exists, existsInAuth: Boolean(authUser),
        role: userData.role || null, email: userData.email || authUser?.email || uid,
        userDoc, authUser,
    };
}

async function transferSnapshotOwnership(adminDb, snapshot, ownerUid, ownerEmail, actorUid) {
    if (snapshot.empty) return;
    const { Timestamp } = await import('firebase-admin/firestore');
    const timestamp = Timestamp.now();
    for (let i = 0; i < snapshot.docs.length; i += 400) {
        const batch = adminDb.batch();
        snapshot.docs.slice(i, i + 400).forEach(d => {
            batch.update(d.ref, { ownerUid, ownerEmail, transferredAt: timestamp, transferredBy: actorUid, updatedAt: timestamp });
        });
        await batch.commit();
    }
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

    let adminContext;
    try { adminContext = await requireAdmin(request, env); if (adminContext.error) return adminContext.error; }
    catch (error) { return json(401, { error: error.message || 'Invalid admin session.' }); }

    const { adminAuth, adminDb, decoded } = adminContext;
    if (uid === decoded.uid) return json(400, { error: 'You cannot delete your own admin account here.' });

    try {
        const targetIdentity = await resolveUserIdentity(adminAuth, adminDb, uid);
        if (!targetIdentity.existsInUsers && !targetIdentity.existsInAuth)
            return json(404, { error: 'That user could not be found.' });
        if (targetIdentity.role === 'admin')
            return json(400, { error: 'Admin accounts cannot be deleted from this panel.' });

        const productsSnapshot = await adminDb.collection('products').where('ownerUid', '==', uid).get();
        const categoriesSnapshot = await adminDb.collection('categories').where('ownerUid', '==', uid).get();
        const productsCount = productsSnapshot.size;
        const categoriesCount = categoriesSnapshot.size;

        if (mode === 'inspect') {
            return json(200, { ok: true, uid, email: targetIdentity.email, role: targetIdentity.role || 'client',
                productsCount, categoriesCount, transferRequired: productsCount > 0 || categoriesCount > 0,
                existsInAuth: targetIdentity.existsInAuth, existsInUsers: targetIdentity.existsInUsers });
        }

        let transferIdentity = null;
        if (productsCount > 0 || categoriesCount > 0) {
            if (!transferToUid) return json(400, { error: 'This user still owns data. Transfer target is required.' });
            if (transferToUid === uid) return json(400, { error: 'Transfer target must be a different user.' });
            transferIdentity = await resolveUserIdentity(adminAuth, adminDb, transferToUid);
            if (!transferIdentity.existsInUsers && !transferIdentity.existsInAuth)
                return json(404, { error: 'Transfer target user was not found.' });
            await transferSnapshotOwnership(adminDb, productsSnapshot, transferToUid, transferIdentity.email, decoded.uid);
            await transferSnapshotOwnership(adminDb, categoriesSnapshot, transferToUid, transferIdentity.email, decoded.uid);
        }

        if (targetIdentity.existsInUsers) await targetIdentity.userDoc.ref.delete();
        if (targetIdentity.existsInAuth) await adminAuth.deleteUser(uid);

        return json(200, { ok: true, uid, email: targetIdentity.email, deleted: true,
            transferred: Boolean(transferIdentity), transferToUid: transferIdentity?.uid || '',
            transferToEmail: transferIdentity?.email || '', productsCount, categoriesCount });
    } catch (error) {
        console.error('[delete-user-account]', error);
        return json(500, { error: error.message || 'Delete user failed.' });
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

    let adminContext;
    try { adminContext = await requireAdmin(request, env); if (adminContext.error) return adminContext.error; }
    catch (error) { return json(401, { error: error.message || 'Invalid admin session.' }); }

    const { adminAuth, adminDb, decoded } = adminContext;

    try {
        const { Timestamp } = await import('firebase-admin/firestore');
        const authUser = await adminAuth.getUserByEmail(email);
        const userRef = adminDb.collection('users').doc(authUser.uid);
        const userSnap = await userRef.get();
        const existingData = userSnap.exists ? userSnap.data() || {} : {};
        const role = existingData.role || requestedRole;
        const timestamp = Timestamp.now();
        const docData = { email: authUser.email || email, role, repairedAt: timestamp, repairedBy: decoded.uid, updatedAt: timestamp };
        if (!userSnap.exists) { docData.createdAt = timestamp; docData.createdBy = decoded.uid; }
        await userRef.set(docData, { merge: true });
        return json(200, { ok: true, uid: authUser.uid, email: authUser.email || email, role, existed: userSnap.exists });
    } catch (error) {
        if (error.code === 'auth/user-not-found') return json(404, { error: 'No Firebase Auth account found for that email.' });
        console.error('[repair-user-by-email]', error);
        return json(500, { error: error.message || 'Repair failed.' });
    }
}

// ── Main Worker ───────────────────────────────────────────────────────────────

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Serve static assets immediately — no Firebase involved
        if (!url.pathname.startsWith('/api/')) {
            return env.ASSETS.fetch(request);
        }

        // API routes — Firebase Admin loaded lazily only here
        try {
            if (url.pathname === '/api/delete-user-account') return handleDeleteUser(request, env);
            if (url.pathname === '/api/repair-user-by-email') return handleRepairUser(request, env);
            return json(404, { error: 'Not found.' });
        } catch (error) {
            return json(500, { error: error.message || 'Internal server error.' });
        }
    },
};

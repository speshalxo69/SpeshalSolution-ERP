import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

function json(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    };
}

function getPrivateKey() {
    return (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
}

function getAdminApp() {
    if (getApps().length > 0) return getApps()[0];

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = getPrivateKey();

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Missing Firebase Admin environment variables.');
    }

    return initializeApp({
        credential: cert({
            projectId,
            clientEmail,
            privateKey,
        }),
    });
}

async function requireAdmin(event) {
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
        return { error: json(401, { error: 'Missing bearer token.' }) };
    }

    const app = getAdminApp();
    const adminAuth = getAuth(app);
    const adminDb = getFirestore(app);

    const decoded = await adminAuth.verifyIdToken(token);
    const callerDoc = await adminDb.collection('users').doc(decoded.uid).get();
    const callerRole = callerDoc.exists ? callerDoc.data()?.role : null;

    if (callerRole !== 'admin') {
        return { error: json(403, { error: 'Admin access required.' }) };
    }

    return {
        adminAuth,
        adminDb,
        decoded,
    };
}

async function getAuthUserSafe(adminAuth, uid) {
    try {
        return await adminAuth.getUser(uid);
    } catch (error) {
        if (error.code === 'auth/user-not-found') return null;
        throw error;
    }
}

async function resolveUserIdentity(adminAuth, adminDb, uid) {
    const userDoc = await adminDb.collection('users').doc(uid).get();
    const authUser = await getAuthUserSafe(adminAuth, uid);
    const userData = userDoc.exists ? (userDoc.data() || {}) : {};

    return {
        uid,
        existsInUsers: userDoc.exists,
        existsInAuth: Boolean(authUser),
        role: userData.role || null,
        email: userData.email || authUser?.email || uid,
        userDoc,
        authUser,
    };
}

async function transferSnapshotOwnership(adminDb, snapshot, ownerUid, ownerEmail, actorUid) {
    if (snapshot.empty) return;

    const docs = snapshot.docs;
    const timestamp = Timestamp.now();

    for (let index = 0; index < docs.length; index += 400) {
        const batch = adminDb.batch();
        const chunk = docs.slice(index, index + 400);

        chunk.forEach((docSnap) => {
            batch.update(docSnap.ref, {
                ownerUid,
                ownerEmail,
                transferredAt: timestamp,
                transferredBy: actorUid,
                updatedAt: timestamp,
            });
        });

        await batch.commit();
    }
}

export const handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return json(405, { error: 'Method not allowed.' });
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return json(400, { error: 'Invalid JSON body.' });
    }

    const mode = String(payload.mode || 'delete').trim().toLowerCase();
    const uid = String(payload.uid || '').trim();
    const transferToUid = String(payload.transferToUid || '').trim();

    if (!uid) {
        return json(400, { error: 'User uid is required.' });
    }

    if (!['inspect', 'delete'].includes(mode)) {
        return json(400, { error: 'Invalid mode.' });
    }

    let adminContext;
    try {
        adminContext = await requireAdmin(event);
        if (adminContext.error) return adminContext.error;
    } catch (error) {
        return json(401, { error: error.message || 'Invalid admin session.' });
    }

    const { adminAuth, adminDb, decoded } = adminContext;

    if (uid === decoded.uid) {
        return json(400, { error: 'You cannot delete your own admin account here.' });
    }

    try {
        const targetIdentity = await resolveUserIdentity(adminAuth, adminDb, uid);

        if (!targetIdentity.existsInUsers && !targetIdentity.existsInAuth) {
            return json(404, { error: 'That user could not be found in Firebase Auth or Firestore.' });
        }

        if (targetIdentity.role === 'admin') {
            return json(400, { error: 'Admin accounts cannot be deleted from this panel.' });
        }

        const productsSnapshot = await adminDb.collection('products').where('ownerUid', '==', uid).get();
        const categoriesSnapshot = await adminDb.collection('categories').where('ownerUid', '==', uid).get();
        const productsCount = productsSnapshot.size;
        const categoriesCount = categoriesSnapshot.size;

        if (mode === 'inspect') {
            return json(200, {
                ok: true,
                uid,
                email: targetIdentity.email,
                role: targetIdentity.role || 'client',
                productsCount,
                categoriesCount,
                transferRequired: productsCount > 0 || categoriesCount > 0,
                existsInAuth: targetIdentity.existsInAuth,
                existsInUsers: targetIdentity.existsInUsers,
            });
        }

        let transferIdentity = null;
        if (productsCount > 0 || categoriesCount > 0) {
            if (!transferToUid) {
                return json(400, { error: 'This user still owns data. Transfer target is required before deletion.' });
            }
            if (transferToUid === uid) {
                return json(400, { error: 'Transfer target must be a different user.' });
            }

            transferIdentity = await resolveUserIdentity(adminAuth, adminDb, transferToUid);
            if (!transferIdentity.existsInUsers && !transferIdentity.existsInAuth) {
                return json(404, { error: 'Transfer target user was not found.' });
            }

            await transferSnapshotOwnership(
                adminDb,
                productsSnapshot,
                transferToUid,
                transferIdentity.email,
                decoded.uid
            );
            await transferSnapshotOwnership(
                adminDb,
                categoriesSnapshot,
                transferToUid,
                transferIdentity.email,
                decoded.uid
            );
        }

        if (targetIdentity.existsInUsers) {
            await targetIdentity.userDoc.ref.delete();
        }

        if (targetIdentity.existsInAuth) {
            await adminAuth.deleteUser(uid);
        }

        return json(200, {
            ok: true,
            uid,
            email: targetIdentity.email,
            deleted: true,
            transferred: Boolean(transferIdentity),
            transferToUid: transferIdentity?.uid || '',
            transferToEmail: transferIdentity?.email || '',
            productsCount,
            categoriesCount,
        });
    } catch (error) {
        console.error('[delete-user-account]', error);
        return json(500, { error: error.message || 'Delete user failed.' });
    }
};

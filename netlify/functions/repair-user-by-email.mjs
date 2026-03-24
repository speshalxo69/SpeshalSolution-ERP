import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const ALLOWED_ROLES = new Set(['admin', 'client']);

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

    const email = String(payload.email || '').trim().toLowerCase();
    const requestedRole = String(payload.role || 'client').trim().toLowerCase();

    if (!email) {
        return json(400, { error: 'Email is required.' });
    }

    if (!ALLOWED_ROLES.has(requestedRole)) {
        return json(400, { error: 'Invalid role.' });
    }

    let adminContext;
    try {
        adminContext = await requireAdmin(event);
        if (adminContext.error) return adminContext.error;
    } catch (error) {
        return json(401, { error: error.message || 'Invalid admin session.' });
    }

    const { adminAuth, adminDb, decoded } = adminContext;

    try {
        const authUser = await adminAuth.getUserByEmail(email);
        const userRef = adminDb.collection('users').doc(authUser.uid);
        const userSnap = await userRef.get();

        const existingData = userSnap.exists ? userSnap.data() || {} : {};
        const role = existingData.role || requestedRole;
        const timestamp = Timestamp.now();

        const docData = {
            email: authUser.email || email,
            role,
            repairedAt: timestamp,
            repairedBy: decoded.uid,
            updatedAt: timestamp,
        };

        if (!userSnap.exists) {
            docData.createdAt = timestamp;
            docData.createdBy = decoded.uid;
        }

        await userRef.set(docData, { merge: true });

        return json(200, {
            ok: true,
            uid: authUser.uid,
            email: authUser.email || email,
            role,
            existed: userSnap.exists,
        });
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            return json(404, { error: 'No Firebase Auth account was found for that email.' });
        }
        console.error('[repair-user-by-email]', error);
        return json(500, { error: error.message || 'Repair failed.' });
    }
};

import rateLimit from "express-rate-limit";

// All the auth endpoints are unauthenticated and cheap to call, so they are the
// ones worth throttling: guesses at a password, mail sent to someone else's
// inbox, and someone hammering a link until it works.
function authLimiter(limit: number, windowMs: number, message: string) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: {
            message
        }
    })
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export const signupLimiter = authLimiter(
    10,
    HOUR,
    "Too many accounts created from this address, please try again later"
);

export const signinLimiter = authLimiter(
    20,
    15 * MINUTE,
    "Too many login attempts, please try again later"
);

export const verifyLimiter = authLimiter(
    30,
    15 * MINUTE,
    "Too many verification attempts, please try again later"
);

export const resendVerificationLimiter = authLimiter(
    5,
    15 * MINUTE,
    "Too many verification emails requested, please try again later"
);

export const forgotPasswordLimiter = authLimiter(
    5,
    15 * MINUTE,
    "Too many password reset emails requested, please try again later"
);

export const resetPasswordLimiter = authLimiter(
    10,
    15 * MINUTE,
    "Too many password reset attempts, please try again later"
);

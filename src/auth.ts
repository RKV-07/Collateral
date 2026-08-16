import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { prisma } from "./db.js";

declare global {
  namespace Express {
    interface User {
      id: string;
      googleId: string;
      email: string;
      name?: string | null;
    }
  }
}

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

const googleClientID = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const baseUrl = (process.env.APP_URL || "").replace(/\/+$/, "");

export function isGoogleConfigured(): boolean {
  return Boolean(googleClientID && googleClientSecret && baseUrl);
}

// Only register the strategy when OAuth credentials exist — the server must
// boot fine without them (e.g. `docker compose up` before the user has set
// GOOGLE_CLIENT_ID/SECRET).
if (isGoogleConfigured()) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientID,
        clientSecret: googleClientSecret,
        callbackURL: `${baseUrl}/auth/google/callback`,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) return done(null, false);

          let user = await prisma.user.findUnique({ where: { googleId: profile.id } });
          if (!user) user = await prisma.user.findUnique({ where: { email } });

          if (!user) {
            user = await prisma.user.create({
              data: {
                googleId: profile.id,
                email,
                name: profile.displayName || profile.name?.givenName || null,
              },
            });
          } else if (user.googleId !== profile.id) {
            user = await prisma.user.update({
              where: { id: user.id },
              data: { googleId: profile.id },
            });
          }
          return done(null, user);
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );
}

export default passport;

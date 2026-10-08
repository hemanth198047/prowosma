import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { Auth0Provider } from '@auth0/auth0-react'
import { AUTH0_DOMAIN, AUTH0_CLIENT_ID, shouldSkipAuth0RedirectCallback } from './config/auth0'
import { initErrorTracking, ErrorTrackingBoundary } from './config/errorTracking'
import { ErrorFallback } from './components/ErrorFallback.jsx'
import './i18n' // must run before any component using useTranslation() renders

// No-op unless VITE_SENTRY_DSN is set — see src/config/errorTracking.js.
initErrorTracking()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorTrackingBoundary fallback={ErrorFallback}>
      <Auth0Provider
        domain={AUTH0_DOMAIN}
        clientId={AUTH0_CLIENT_ID}
        // Only /auth0/callback is an Auth0 return. Other pages that arrive with ?code=&state= (the Google Meet connection) are not Auth0's.
        skipRedirectCallback={shouldSkipAuth0RedirectCallback(window.location.pathname)}
        authorizationParams={{
          redirect_uri: `${window.location.origin}/auth0/callback`,
          scope: "openid profile email",
        }}
      >
        <App />
      </Auth0Provider>
    </ErrorTrackingBoundary>
  </React.StrictMode>,
)

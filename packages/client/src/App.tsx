import { HomeView } from "./views/HomeView.js";
import { PatientView } from "./views/PatientView.js";
import { ProviderView } from "./views/ProviderView.js";

export interface AppProps {
  baseUrl: string;
  pathname: string;
}

/**
 * The provider and patient links are `/p/:key` and `/w/:key`.
 * There is no routing dependency in scope, so this is a plain path match.
 */
function parsePath(pathname: string): { view: "provider" | "patient"; key: string } | undefined {
  const providerMatch = pathname.match(/^\/p\/(.+)$/);
  if (providerMatch) {
    return { view: "provider", key: decodeURIComponent(providerMatch[1]) };
  }

  const patientMatch = pathname.match(/^\/w\/(.+)$/);
  if (patientMatch) {
    return { view: "patient", key: decodeURIComponent(patientMatch[1]) };
  }

  return undefined;
}

export function App({ baseUrl, pathname }: AppProps) {
  const route = parsePath(pathname);

  if (!route) {
    return <HomeView baseUrl={baseUrl} />;
  }

  if (route.view === "provider") {
    return <ProviderView baseUrl={baseUrl} sessionKey={route.key} />;
  }

  return <PatientView baseUrl={baseUrl} sessionKey={route.key} />;
}

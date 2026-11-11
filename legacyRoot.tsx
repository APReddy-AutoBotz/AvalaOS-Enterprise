// The earlier application with its providers. Loaded only for paths the process journey does not own.
import App from './App';
import { AuthProvider } from './components/auth/AuthProvider';
import { OrganizationProvider } from './components/auth/OrganizationProvider';
import { DeliveryProvider } from './components/delivery/DeliveryProvider';
import { DocsProvider } from './components/docs/DocsProvider';

export default function LegacyRoot() {
  return (
    <AuthProvider>
      <OrganizationProvider>
        <DeliveryProvider>
          <DocsProvider>
            <App />
          </DocsProvider>
        </DeliveryProvider>
      </OrganizationProvider>
    </AuthProvider>
  );
}

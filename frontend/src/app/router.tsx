import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { ApiAvailabilityGate } from "../components/ApiAvailabilityGate";
import { ApplicationShell } from "../components/ApplicationShell";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { CustomersPage } from "../pages/CustomersPage";
import { CustomerDetailPage } from "../pages/CustomerDetailPage";
import { CustomerFormPage } from "../pages/CustomerFormPage";

const unavailableImportTools = "Import tools arrive in a unavailable feature.";
const unavailableCampaignTools = "Campaign tools arrive in a unavailable feature.";

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <ApplicationShell />,
    children: [
      {
        element: <ApiAvailabilityGate />,
        children: [
          {
            index: true,
            element: (
              <PlaceholderPage
                eyebrow="Workspace"
                title="Campaign overview"
                description="Campaign activity and operational counts arrive in later stages."
              />
            ),
          },
          {
            path: "customers",
            element: <CustomersPage />,
          },
          {
            path: "customers/new",
            element: <CustomerFormPage mode="create" />,
          },
          {
            path: "customers/:customerId",
            element: <CustomerDetailPage />,
          },
          {
            path: "customers/:customerId/edit",
            element: <CustomerFormPage mode="update" />,
          },
          {
            path: "imports",
            element: <PlaceholderPage eyebrow="Data operations" title="Imports" description={unavailableImportTools} />,
          },
          {
            path: "imports/new",
            element: <PlaceholderPage eyebrow="Data operations" title="New import" description={unavailableImportTools} />,
          },
          {
            path: "imports/:jobId",
            element: <PlaceholderPage eyebrow="Data operations" title="Import details" description={unavailableImportTools} />,
          },
          {
            path: "campaigns",
            element: <PlaceholderPage eyebrow="Campaigns" title="Campaigns" description={unavailableCampaignTools} />,
          },
          {
            path: "campaigns/new",
            element: <PlaceholderPage eyebrow="Campaigns" title="New campaign" description={unavailableCampaignTools} />,
          },
          {
            path: "campaigns/:campaignId",
            element: <PlaceholderPage eyebrow="Campaigns" title="Campaign details" description={unavailableCampaignTools} />,
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

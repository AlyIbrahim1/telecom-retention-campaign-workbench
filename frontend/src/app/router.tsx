import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { ApiAvailabilityGate } from "../components/ApiAvailabilityGate";
import { ApplicationShell } from "../components/ApplicationShell";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { CustomersPage } from "../pages/CustomersPage";
import { CustomerDetailPage } from "../pages/CustomerDetailPage";
import { CustomerFormPage } from "../pages/CustomerFormPage";
import { ImportsPage } from "../pages/ImportsPage";
import { ImportNewPage } from "../pages/ImportNewPage";
import { ImportDetailPage } from "../pages/ImportDetailPage";

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
            element: <ImportsPage />,
          },
          {
            path: "imports/new",
            element: <ImportNewPage />,
          },
          {
            path: "imports/:jobId",
            element: <ImportDetailPage />,
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

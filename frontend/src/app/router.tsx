import { createBrowserRouter, type RouteObject } from "react-router-dom";

import { ApiAvailabilityGate } from "../components/ApiAvailabilityGate";
import { ApplicationShell } from "../components/ApplicationShell";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";

const unavailableCustomerTools = "Customer tools arrive in a unavailable feature.";
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
            element: <PlaceholderPage eyebrow="Customers" title="Customers" description={unavailableCustomerTools} />,
          },
          {
            path: "customers/new",
            element: <PlaceholderPage eyebrow="Customers" title="New customer" description={unavailableCustomerTools} />,
          },
          {
            path: "customers/:customerId",
            element: <PlaceholderPage eyebrow="Customers" title="Customer details" description={unavailableCustomerTools} />,
          },
          {
            path: "customers/:customerId/edit",
            element: <PlaceholderPage eyebrow="Customers" title="Update customer" description={unavailableCustomerTools} />,
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

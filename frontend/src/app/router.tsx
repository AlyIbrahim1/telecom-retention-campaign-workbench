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
import { CampaignsPage } from "../pages/CampaignsPage";
import { CampaignNewPage } from "../pages/CampaignNewPage";
import { CampaignDetailPage } from "../pages/CampaignDetailPage";
import { ChatPage } from "../pages/ChatPage";

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
            element: <CampaignsPage />,
          },
          {
            path: "campaigns/new",
            element: <CampaignNewPage />,
          },
          {
            path: "campaigns/:campaignId",
            element: <CampaignDetailPage />,
          },
          {
            path: "chat",
            element: <ChatPage />,
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);

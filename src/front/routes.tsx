import { createBrowserRouter, Navigate } from "react-router";
import { RequireAuth } from "./components/RequireAuth";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MyPage } from "./pages/MyPage";
import { RouteError } from "./components/RouteError";
import { CustomersPage } from "./pages/CustomersPage";
import { CustomerPage } from "./pages/CustomerPage";
import { CasePage } from "./pages/CasePage";
import { DashboardPage } from "./pages/DashboardPage";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/home" replace /> },
  { path: "/home", element: <HomePage />, errorElement: <RouteError /> },
  { path: "/login", element: <LoginPage />, errorElement: <RouteError /> },
  ...[
    { path: "/customers", element: <CustomersPage /> },
    { path: "/customers/:customerId", element: <CustomerPage /> },
    { path: "/cases/:caseId", element: <CasePage /> },
    { path: "/assessments/:assessmentId", element: <DashboardPage /> },
  ].map((route) => ({
    ...route,
    element: <RequireAuth>{route.element}</RequireAuth>,
    errorElement: <RouteError />,
  })),
  {
    path: "/mypage",
    errorElement: <RouteError />,
    element: (
      <RequireAuth>
        <MyPage />
      </RequireAuth>
    ),
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

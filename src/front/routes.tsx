import { createBrowserRouter, Navigate } from "react-router";
import { RequireAuth } from "./components/RequireAuth";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MyPage } from "./pages/MyPage";
import { RouteError } from "./components/RouteError";

export const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/home" replace /> },
  { path: "/home", element: <HomePage />, errorElement: <RouteError /> },
  { path: "/login", element: <LoginPage />, errorElement: <RouteError /> },
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

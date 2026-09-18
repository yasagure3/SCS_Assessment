export type AppRole = "admin" | "staff";
export type Me = {
  id: string;
  email: string;
  role: AppRole;
  customerIds: string[];
  status: "active";
};

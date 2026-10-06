export type UserRole = "ADMIN" | "RESELLER";

export type PublicUser = {
  id: string;
  documentId: string;
  firstName: string;
  lastName: string;
  email: string;
  gender: "female" | "male" | "unspecified";
  birthDate: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
};

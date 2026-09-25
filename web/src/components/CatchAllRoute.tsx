import { useAtomValue } from "jotai";
import { authAtom } from "@/stores/authAtom";
import AssessorLayout from "@/components/layout/AssessorLayout";
import CandidateLayout from "@/components/layout/CandidateLayout";
import NotFoundState from "@/components/resource/NotFoundState";

export default function CatchAllRoute() {
  const { token } = useAtomValue(authAtom);

  const notFound = (
    <NotFoundState
      title="Page not found"
      description="The page you're looking for doesn't exist."
      backTo={token ? "/assessments" : "/login"}
      backLabel={token ? "Back to assessments" : "Go to login"}
    />
  );

  return token ? <AssessorLayout>{notFound}</AssessorLayout> : <CandidateLayout>{notFound}</CandidateLayout>;
}

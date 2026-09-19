import { AssessmentLayout } from "../components/assessments/AssessmentLayout";
import { CriteriaList } from "../components/assessments/CriteriaList";
export function CriteriaPage() {
  return (
    <AssessmentLayout title="評価基準一覧">
      {({ record, standard }) => <CriteriaList record={record} standard={standard} />}
    </AssessmentLayout>
  );
}

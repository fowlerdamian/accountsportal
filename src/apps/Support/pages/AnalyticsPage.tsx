import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AnalyticsTab from '@/components/analytics/AnalyticsTab';
import ReportsTab from '@/components/analytics/ReportsTab';

export default function AnalyticsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-heading">ANALYTICS & REPORTS</h2>
      </div>

      <Tabs defaultValue="analytics" className="w-full">
        <TabsList className="bg-card border border-border rounded-none mb-6">
          <TabsTrigger value="analytics" className="rounded-none text-xs font-heading tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            ANALYTICS
          </TabsTrigger>
          <TabsTrigger value="reports" className="rounded-none text-xs font-heading tracking-wider data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            REPORTS
          </TabsTrigger>
        </TabsList>
        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

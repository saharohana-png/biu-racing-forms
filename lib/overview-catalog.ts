/** Small, generated navigation catalog. Full form schemas load with the editor. */
import overviewData from '@/data/systems.overview.json';

export type OverviewField={id:string;label:string};
export type OverviewSystem={
 id:string;
 label:string;
 department:string;
 electricalDomain:string;
 interfaces:string[];
 fields:OverviewField[];
};

export const systems:OverviewSystem[]=overviewData;

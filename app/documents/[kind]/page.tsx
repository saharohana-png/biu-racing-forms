import { notFound } from 'next/navigation';
import { OfficialDocument } from '@/components/racing/official-document';

export default async function DocumentPage({params}:{params:Promise<{kind:string}>}){
 const {kind}=await params;
 if(kind==='esf'||kind==='ases'||kind==='ses')return <OfficialDocument kind={kind}/>;
 notFound();
}

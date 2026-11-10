import { Link } from 'react-router-dom';
import { ChevronRight, GitFork, HelpCircle } from 'lucide-react';
import { api } from '../api/client';
import { useMockData } from '../api/dataSource';
import { lineageChain } from '../api/remix';
import { AddressChip, Badge, Button, Card, CardHeader, EmptyState, Pill, Skeleton, shortAddr } from './ui';
import { useAsync } from './useAsync';

/**
 * Remix lineage of a level (GET /levels/:id/remixes): the ancestors chain, root first, down to this level,
 * then its direct remixes. Backed by the indexed `LevelPublished.parentId`.
 */
export function RemixLineage({ id, name, creator, canRemix }: { id: number; name: string; creator: string; canRemix: boolean }) {
    const { data, loading, error, reload } = useAsync(() => api.getRemixes(id), [id]);
    const sample = useMockData(`/levels/${id}/remixes`);

    const total = data?.descendants ?? 0;
    const aside = (
        <span className="row-sm">
            {sample && <Badge tone="neutral">Sample</Badge>}
            {data && <span className="fine">{total === 1 ? '1 remix in total' : `${total} remixes in total`}</span>}
        </span>
    );

    let body;
    if (loading && !data) body = <Skeleton h={96} />;
    else if (error && !data)
        body = (
            <EmptyState compact tone="error" title="Lineage unavailable" action={<Button size="sm" onClick={reload}>Retry</Button>}>
                {error.message}
            </EmptyState>
        );
    else if (data && data.parentId === 0 && data.children.length === 0)
        body = (
            <EmptyState compact icon={<GitFork size={22} />} title="Original level, no remixes yet" action={canRemix ? <Button to={`/editor?remix=${id}`} size="sm" variant="primary">Remix it first</Button> : undefined}>
                Remixes are child LevelNFTs; this level's creator shares their resale royalty.
            </EmptyState>
        );
    else if (data) {
        const chain = lineageChain(data, { id, name, creator });
        body = (
            <div className="lineage">
                {data.parentId > 0 && (
                    <>
                        <h3 className="mini-title">Remixed from</h3>
                        <ol className="lineage-chain" aria-label="Ancestors, original first">
                            {chain.map((n, i) => (
                                <li key={n.kind === 'level' ? n.id : `missing-${i}`}>
                                    {i > 0 && <ChevronRight size={14} aria-hidden className="lineage-sep" />}
                                    {n.kind === 'missing' ? (
                                        <span className="lineage-node is-missing" title="Not indexed by this server (the indexer may have started later)">
                                            <HelpCircle size={13} aria-hidden /> {n.id ? `#${n.id}` : 'Earlier levels'}
                                        </span>
                                    ) : n.current ? (
                                        <span className="lineage-node is-current" aria-current="page">
                                            #{n.id} {n.name}
                                        </span>
                                    ) : (
                                        <Link className="lineage-node" to={`/level/${n.id}`} title={`By ${shortAddr(n.creator)}`}>
                                            #{n.id} {n.name}
                                        </Link>
                                    )}
                                </li>
                            ))}
                        </ol>
                    </>
                )}
                <h3 className="mini-title">{data.children.length ? `Direct remixes (${data.children.length})` : 'Direct remixes'}</h3>
                {data.children.length ? (
                    <ul className="lineage-children">
                        {data.children.map((c) => (
                            <li key={c.id}>
                                <Link to={`/level/${c.id}`} className="lineage-child-name">
                                    #{c.id} {c.name}
                                </Link>
                                <AddressChip address={c.creator} copy={false} />
                                <span className="fine num">{c.plays.toLocaleString()} plays</span>
                                {c.remixes > 0 ? <Pill tone="violet">{c.remixes === 1 ? '1 remix' : `${c.remixes} remixes`}</Pill> : <span />}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="fine">No remixes of this level yet.</p>
                )}
            </div>
        );
    }

    return (
        <Card className="lineage-card">
            <CardHeader icon={<GitFork size={18} />} title="Remix lineage" aside={aside} />
            {body}
        </Card>
    );
}

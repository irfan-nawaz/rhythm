'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useDeferredValue, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { BusyButton, FormField, Loading, Sheet } from '@/components/kit';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage, type Food, type Meal, type Ticked } from '@/lib/api';

type Step = 'search' | 'amount' | 'custom';

const round1 = (n: number) => Math.round(n * 10) / 10;

export function AddFood({ open, onOpenChange, meal, date }: { open: boolean; onOpenChange: (open: boolean) => void; meal: Meal; date: string }) {
  const t = useTranslations('food');
  const tToday = useTranslations('today');
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [food, setFood] = useState<Food | null>(null);
  const [grams, setGrams] = useState('');
  const [error, setError] = useState<string | null>(null);
  const search = useDeferredValue(query.trim());
  const mealName = t(`meals.${meal}`);

  useEffect(() => {
    if (open) {
      setStep('search');
      setQuery('');
      setFood(null);
      setError(null);
    }
  }, [open]);

  const recent = useQuery({ queryKey: ['foods', 'recent'], queryFn: () => api.get<{ foods: Food[] }>('/api/foods/recent'), enabled: open });
  const results = useQuery({
    queryKey: ['foods', 'search', search],
    queryFn: () => api.get<{ foods: Food[] }>(`/api/foods?q=${encodeURIComponent(search)}`),
    enabled: open && search.length > 0,
  });

  const add = useMutation({
    mutationFn: () => api.post<{ ticked: Ticked[] }>('/api/nutrition/entries', { foodId: food!.id, meal, date, quantityG: Number(grams) }),
    onSuccess: ({ ticked }) => {
      // Logging lunch also ticks off a Lunch task linked to it.
      const titles = ticked.map((x) => x.title).join(', ');
      toast.success(t('added', { meal: mealName }), { description: ticked.length > 0 ? tToday('tickedOff', { titles }) : undefined });
      if (ticked.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['today'] });
        queryClient.invalidateQueries({ queryKey: ['calendar'] });
      }
      queryClient.invalidateQueries({ queryKey: ['nutrition'] });
      queryClient.invalidateQueries({ queryKey: ['foods', 'recent'] });
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const createFood = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ food: Food }>('/api/foods', body),
    onSuccess: ({ food: created }) => {
      toast.success(t('savedFood'));
      choose(created);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function choose(chosen: Food) {
    setFood(chosen);
    setGrams(String(chosen.lastQuantityG ?? chosen.servingG));
    setError(null);
    setStep('amount');
  }

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const num = (key: string) => Number(form.get(key) || 0);
    createFood.mutate({
      name: form.get('name'),
      kcal: num('kcal'),
      proteinG: num('protein'),
      carbsG: num('carbs'),
      fatG: num('fat'),
      servingG: num('servingG') || 100,
      servingLabel: form.get('servingLabel') || null,
    });
  }

  const list = search ? (results.data?.foods ?? []) : (recent.data?.foods ?? []);
  const loading = search ? results.isPending : recent.isPending;
  const k = Number(grams) / 100 || 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('addTo', { meal: mealName })}>
      {step === 'search' ? (
        <div className="flex flex-col gap-4">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchLabel')} />
          <h3 className="text-sm font-bold text-muted-foreground">{search ? t('results') : t('recent')}</h3>
          {loading ? (
            <Loading />
          ) : (
            <ul className="-mt-2">
              {list.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => choose(f)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left hover:bg-muted">
                    <span className="font-semibold">{f.name}</span>
                    <span className="shrink-0 text-sm text-muted-foreground">{Math.round(f.kcal)} kcal / 100 g</span>
                  </button>
                </li>
              ))}
              {search && list.length === 0 ? <li className="px-3 text-muted-foreground">{t('noResults', { query: search })}</li> : null}
            </ul>
          )}
          <Button variant="outline" onClick={() => setStep('custom')}>
            {t('custom')}
          </Button>
        </div>
      ) : null}

      {step === 'amount' && food ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <p className="text-lg font-bold">{food.name}</p>
          {food.servingLabel ? (
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3].map((n) => (
                <Button key={n} type="button" variant={Number(grams) === food.servingG * n ? 'default' : 'secondary'} size="sm" onClick={() => setGrams(String(food.servingG * n))}>
                  {t('servingChip', { count: n, label: food.servingLabel! })}
                </Button>
              ))}
            </div>
          ) : null}
          <FormField label={t('quantity')}>
            {(id) => <Input id={id} type="number" inputMode="decimal" min="1" step="1" value={grams} onChange={(e) => setGrams(e.target.value)} required />}
          </FormField>
          <p className="rounded-xl bg-muted p-3 text-muted-foreground">
            {t('preview', { kcal: Math.round(food.kcal * k), protein: round1(food.proteinG * k), carbs: round1(food.carbsG * k), fat: round1(food.fatG * k) })}
          </p>
          {error ? <p className="text-destructive">{error}</p> : null}
          <div className="flex justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep('search')}>
              {t('backToSearch')}
            </Button>
            <BusyButton type="submit" busy={add.isPending} disabled={!(Number(grams) > 0)}>
              {t('addTo', { meal: mealName })}
            </BusyButton>
          </div>
        </form>
      ) : null}

      {step === 'custom' ? (
        <form onSubmit={submitCustom} className="flex flex-col gap-4">
          <p className="text-muted-foreground">{t('customHint')}</p>
          <FormField label={t('customName')}>{(id) => <Input id={id} name="name" required maxLength={100} defaultValue={query} />}</FormField>
          <p className="font-semibold">{t('per100')}</p>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['kcal', t('kcalField')],
                ['protein', t('proteinField')],
                ['carbs', t('carbsField')],
                ['fat', t('fatField')],
              ] as const
            ).map(([name, label]) => (
              <FormField key={name} label={label}>
                {(id) => <Input id={id} name={name} type="number" inputMode="decimal" min="0" step="0.1" required />}
              </FormField>
            ))}
            <FormField label={t('servingSize')}>{(id) => <Input id={id} name="servingG" type="number" inputMode="decimal" min="1" step="1" defaultValue="100" />}</FormField>
            <FormField label={t('servingLabel')}>{(id) => <Input id={id} name="servingLabel" maxLength={40} placeholder={t('servingLabelPlaceholder')} />}</FormField>
          </div>
          {error ? <p className="text-destructive">{error}</p> : null}
          <div className="flex justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep('search')}>
              {t('backToSearch')}
            </Button>
            <BusyButton type="submit" busy={createFood.isPending}>
              {t('saveFood')}
            </BusyButton>
          </div>
        </form>
      ) : null}
    </Sheet>
  );
}

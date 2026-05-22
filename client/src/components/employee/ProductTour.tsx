import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, X, ChevronRight, ChevronLeft } from 'lucide-react';

export function ProductTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('tour_seen_v2');
    if (!hasSeenTour) {
      const timer = setTimeout(() => setIsOpen(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const steps = [
    {
      title: 'Welcome to Track AI v2.4',
      content: 'We have updated your dashboard with powerful new tools to help you manage your work more effectively.',
      icon: <Sparkles className="w-8 h-8 text-purple-500" />
    },
    {
      title: 'Enhanced Task Reporting',
      content: 'You can now attach multiple images and videos to your daily reports to provide better context to your team.',
      icon: <Sparkles className="w-8 h-8 text-blue-500" />
    },
    {
      title: 'Feature Voting',
      content: 'Have a great idea? Submit it in the Feature Voting tab and let the community vote on it!',
      icon: <Sparkles className="w-8 h-8 text-amber-500" />
    },
    {
      title: 'Company Knowledge Base',
      content: 'Access all company policies, onboarding guides, and wikis directly from your sidebar.',
      icon: <Sparkles className="w-8 h-8 text-green-500" />
    }
  ];

  const handleClose = () => {
    setIsOpen(false);
    localStorage.setItem('tour_seen_v2', 'true');
  };

  if (!isOpen) return null;

  const step = steps[currentStep];

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
      <Card className="max-w-md w-full shadow-2xl border-0 overflow-hidden rounded-3xl animate-in zoom-in-95 duration-300">
        <div className="p-1 bg-linear-to-r from-purple-500 via-blue-500 to-green-500" />
        <CardContent className="p-8 space-y-6 relative">
          <Button 
            variant="ghost" 
            size="icon" 
            className="absolute top-4 right-4 rounded-full h-8 w-8"
            onClick={handleClose}
          >
            <X className="w-4 h-4" />
          </Button>

          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center shadow-inner">
              {step.icon}
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-bold tracking-tight">{step.title}</h3>
              <p className="text-muted-foreground leading-relaxed">
                {step.content}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1.5 rounded-full transition-all duration-300 ${i === currentStep ? 'w-6 bg-blue-500' : 'w-1.5 bg-slate-200'}`} 
                />
              ))}
            </div>
            <div className="flex gap-2">
              {currentStep > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(prev => prev - 1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Back
                </Button>
              )}
              <Button 
                size="sm" 
                className="bg-slate-900 text-white hover:bg-black rounded-xl px-6"
                onClick={() => {
                  if (currentStep < steps.length - 1) {
                    setCurrentStep(prev => prev + 1);
                  } else {
                    handleClose();
                  }
                }}
              >
                {currentStep === steps.length - 1 ? 'Get Started' : 'Next'}
                {currentStep < steps.length - 1 && <ChevronRight className="w-4 h-4 ml-1" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}